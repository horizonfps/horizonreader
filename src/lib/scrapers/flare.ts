// Gateway in front of FlareSolverr. Chromium is by far the most expensive thing
// in the stack, so a solve is paid once per host and then reused: the clearance
// cookies ride on plain fetches until the site stops accepting them.

import { isMuted, recordFail, recordOk } from "@/lib/backbone/sourceStats";

const FLARE = process.env.FLARESOLVERR_URL || "";
const FLARE_TIMEOUT = Number(process.env.FLARE_TIMEOUT_MS || 60_000);
// One browser context per concurrent call, so this is the real memory knob.
const CONCURRENCY = Number(process.env.FLARE_CONCURRENCY || 2);
// Past this, callers fail fast instead of queueing behind a stalled Chromium.
const MAX_QUEUE = Number(process.env.FLARE_MAX_QUEUE || 8);
const CLEARANCE_TTL_MS = 30 * 60_000;

export type Clearance = { cookie: string; userAgent: string; at: number };

const clearances = new Map<string, Clearance>();
const inflight = new Map<string, Promise<string>>();

let active = 0;
const waiters: (() => void)[] = [];

export function flareEnabled(): boolean {
  return !!FLARE;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// A host whose solves keep failing is skipped outright; retrying it is what
// piles browser contexts up.
function breakerKey(host: string): string {
  return `flare:${host}`;
}

export function getClearance(url: string): Clearance | null {
  const c = clearances.get(hostOf(url));
  if (!c) return null;
  if (Date.now() - c.at > CLEARANCE_TTL_MS) return null;
  return c;
}

export function dropClearance(url: string): void {
  clearances.delete(hostOf(url));
}

// The slot is handed straight to the next waiter rather than released and
// re-taken, so the limit can never overshoot and an admitted caller is never
// rejected afterwards.
async function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active += 1;
    return;
  }
  if (waiters.length >= MAX_QUEUE) throw new Error("flare_busy");
  await new Promise<void>((r) => waiters.push(r));
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active -= 1;
}

// FlareSolverr wraps non-HTML bodies (e.g. admin-ajax JSON) in
// <html>…<pre>PAYLOAD</pre>…</html>. Unwrap so callers can JSON.parse.
function unwrapPre(html: string): string {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!m) return html;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

async function callFlare(
  cmd: "request.get" | "request.post",
  url: string,
  postData?: string,
): Promise<string> {
  const body: Record<string, unknown> = { cmd, url, maxTimeout: FLARE_TIMEOUT };
  if (postData !== undefined) body.postData = postData;

  const res = await fetch(`${FLARE}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    // Never outlive the solver's own budget, or the request leaks a context.
    signal: AbortSignal.timeout(FLARE_TIMEOUT + 15_000),
  });
  const json = (await res.json()) as {
    status?: string;
    solution?: {
      response?: string;
      userAgent?: string;
      cookies?: { name: string; value: string }[];
    };
  };
  if (json.status !== "ok" || !json.solution?.response) throw new Error("flaresolverr_failed");

  const cookies = json.solution.cookies ?? [];
  if (cookies.length && json.solution.userAgent) {
    clearances.set(hostOf(url), {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      userAgent: json.solution.userAgent,
      at: Date.now(),
    });
  }
  return unwrapPre(json.solution.response);
}

// Solve through FlareSolverr under the global limit. Concurrent callers asking
// for the same thing share one browser context instead of each getting theirs.
export async function flareSolve(
  cmd: "request.get" | "request.post",
  url: string,
  postData?: string,
): Promise<string> {
  if (!FLARE) throw new Error("flaresolverr_disabled");
  const host = hostOf(url);
  if (isMuted(breakerKey(host))) throw new Error("flare_host_muted");

  const key = `${cmd}:${url}:${postData ?? ""}`;
  const shared = inflight.get(key);
  if (shared) return shared;

  const run = (async () => {
    await acquire();
    const started = Date.now();
    try {
      const html = await callFlare(cmd, url, postData);
      recordOk(breakerKey(host), Date.now() - started);
      return html;
    } catch (e) {
      recordFail(breakerKey(host));
      throw e;
    } finally {
      release();
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, run);
  return run;
}
