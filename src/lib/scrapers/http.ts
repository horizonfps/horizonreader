// Server-side fetch helpers for native scrapers. A direct fetch is tried first,
// carrying any clearance won by an earlier solve, and [[flare]] is only paid
// when that fails: 403 WAF, datacenter-IP block, or a real CF challenge.

import {
  dropClearance,
  flareEnabled,
  flareSolve,
  getClearance,
  looksLikeChallenge,
  solveClearance,
  solverSupportsPost,
} from "./flare";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const TIMEOUT = 20_000;

// Status codes a WAF/CDN answers a block with. A 404 or 500 means the origin
// itself failed, which a solve cannot fix, so only these justify the cost.
const BLOCK_STATUSES = new Set([403, 429, 503]);

class HttpStatusError extends Error {
  constructor(readonly status: number, method: string, url: string) {
    super(`${method} ${url} -> ${status}`);
  }
}

// Cloudflare's own 52x range is the edge failing to reach the origin behind a
// challenge, which a solve does fix.
function isBlockStatus(status: number): boolean {
  return BLOCK_STATUSES.has(status) || (status >= 520 && status <= 529);
}

// A response we actually got but that isn't a block indicator is never worth
// escalating; anything else (timeout, connection refused) has no status to
// check and is treated as the datacenter-IP block case flare exists for.
function isBlockingFailure(e: unknown): boolean {
  if (e instanceof HttpStatusError) return isBlockStatus(e.status);
  return true;
}

// A challenge served as 200: the body is the interstitial, not the content.
// Returning it would have the caller parse an empty page as a valid answer.
class ChallengeBodyError extends Error {
  constructor(url: string) {
    super(`challenge body ${url}`);
  }
}

function baseHeaders(url: string, referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
  };
  if (referer) h["Referer"] = referer;
  // Reuse a solved session: the cookie only works with the UA it was issued to.
  const clearance = getClearance(url);
  if (clearance) {
    h["Cookie"] = clearance.cookie;
    h["User-Agent"] = clearance.userAgent;
  }
  return h;
}

export async function getText(url: string, referer?: string): Promise<string> {
  const hadClearance = !!getClearance(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: baseHeaders(url, referer ?? url),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new HttpStatusError(res.status, "GET", url);
    const body = await res.text();
    if (looksLikeChallenge(body)) throw new ChallengeBodyError(url);
    return body;
  } catch (e) {
    if (!isBlockingFailure(e)) throw e;
    // Stale clearance is worse than none: drop it so the solve starts clean.
    if (hadClearance) dropClearance(url);
    if (flareEnabled()) return flareSolve("request.get", url);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function rawPost(url: string, encoded: string, referer?: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...baseHeaders(url, referer ?? url),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: encoded,
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new HttpStatusError(res.status, "POST", url);
    const body = await res.text();
    if (looksLikeChallenge(body)) throw new ChallengeBodyError(url);
    return body;
  } finally {
    clearTimeout(t);
  }
}

export async function postForm(
  url: string,
  form: Record<string, string>,
  referer?: string,
): Promise<string> {
  const encoded = new URLSearchParams(form).toString();
  const hadClearance = !!getClearance(url);
  try {
    return await rawPost(url, encoded, referer);
  } catch (e) {
    if (!isBlockingFailure(e)) throw e;
    // Stale clearance is worse than none: drop it so the solve starts clean.
    if (hadClearance) dropClearance(url);
    if (!flareEnabled()) throw e;
    // A GET-only solver can still hand over the clearance cookies; the POST is
    // then replayed here, which is the only way to keep form-based sources.
    if (!solverSupportsPost()) {
      const clearance = await solveClearance(url);
      if (!clearance) throw e;
      return rawPost(url, encoded, referer);
    }
    return flareSolve("request.post", url, encoded);
  }
}
