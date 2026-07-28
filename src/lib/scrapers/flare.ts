// Gateway in front of the challenge solvers. Chromium/Firefox is by far the
// most expensive thing in the stack, so a solve is paid once per host and then
// reused: the clearance cookies ride on plain fetches until the site stops
// accepting them.
//
// Two solver flavors are supported because neither wins alone: FlareSolverr
// speaks the full API (POST, sessions) and clears some sites Byparr misses,
// while Byparr drives a stealth Firefox that beats the managed challenges
// FlareSolverr is fingerprinted on. Both are asked, best-known-first per host,
// and a reply that is still a challenge page counts as a failure.

import { isMuted, recordFail, recordOk } from "@/lib/backbone/sourceStats";

type SolverKind = "flaresolverr" | "byparr";
type Solver = { kind: SolverKind; url: string };

const FLARE_TIMEOUT = Number(process.env.FLARE_TIMEOUT_MS || 60_000);
// One browser context per concurrent call, so this is the real memory knob.
const CONCURRENCY = Number(process.env.FLARE_CONCURRENCY || 2);
// Past this, callers fail fast instead of queueing behind a stalled browser.
const MAX_QUEUE = Number(process.env.FLARE_MAX_QUEUE || 8);
// Expiring early is what costs a browser boot and a 10-30s wait. Expiring late
// costs one fast rejection before the solve that would have happened anyway,
// which http.ts already handles by dropping the cookie and solving clean.
const CLEARANCE_TTL_MS = Number(process.env.CLEARANCE_TTL_MS || 90 * 60_000);
// Headroom for the solver to answer with its own error instead of being cut
// off mid-solve.
const SOLVE_GRACE_MS = 5_000;
// A solve costs a whole browser context and takes tens of seconds, so an
// attempt that cannot plausibly finish in what is left is never started.
const MIN_ATTEMPT_MS = 15_000;

// SOLVERS="flaresolverr@http://flaresolverr:8191,byparr@http://byparr:8191".
// Falls back to the single-solver env pair kept for older deployments.
function parseSolvers(): Solver[] {
  const raw = (process.env.SOLVERS || "").trim();
  const out: Solver[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      const [kindRaw, ...rest] = part.trim().split("@");
      const url = rest.join("@").trim().replace(/\/+$/, "");
      const kind = kindRaw.trim().toLowerCase();
      if (!url) continue;
      out.push({ kind: kind === "byparr" ? "byparr" : "flaresolverr", url });
    }
    if (out.length) return out;
  }
  const single = (process.env.FLARESOLVERR_URL || "").trim().replace(/\/+$/, "");
  if (!single) return [];
  const kind = (process.env.SOLVER_KIND || "flaresolverr").toLowerCase();
  return [{ kind: kind === "byparr" ? "byparr" : "flaresolverr", url: single }];
}

const SOLVERS = parseSolvers();

export type Clearance = { cookie: string; userAgent: string; at: number };

const clearances = new Map<string, Clearance>();
const inflight = new Map<string, Promise<string>>();
// Which solver last cleared a host; tried first next time.
const preferred = new Map<string, SolverKind>();

type Waiter = { grant: () => void; settled: boolean };

let active = 0;
const waiters: Waiter[] = [];

export function flareEnabled(): boolean {
  return SOLVERS.length > 0;
}

// Whether any solver can replay a form POST through the challenge itself.
export function solverSupportsPost(): boolean {
  return SOLVERS.some((s) => s.kind === "flaresolverr");
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

// The engine an IP is fingerprinted on for one host still clears every other
// host, so the penalty is remembered per solver and host, never globally.
function solverKey(kind: SolverKind, host: string): string {
  return `flare:${kind}:${host}`;
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
// rejected afterwards. Waiting counts against the deadline: a queue longer
// than the caller's patience must not spend a browser context on it.
async function acquire(deadline: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("solver_aborted");
  if (active < CONCURRENCY) {
    active += 1;
    return;
  }
  if (waiters.length >= MAX_QUEUE) throw new Error("flare_busy");
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { settled: false, grant: () => (settle(), resolve()) };
    const giveUp = (reason: string) => {
      if (waiter.settled) return;
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
      settle();
      reject(new Error(reason));
    };
    const patience = deadline - Date.now();
    const timer = Number.isFinite(patience)
      ? setTimeout(() => giveUp("solver_budget_exhausted"), Math.max(0, patience))
      : null;
    const onAbort = () => giveUp("solver_aborted");
    signal?.addEventListener("abort", onAbort, { once: true });

    function settle() {
      waiter.settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    waiters.push(waiter);
  });
}

function release(): void {
  while (waiters.length) {
    const next = waiters.shift()!;
    if (next.settled) continue;
    next.grant();
    return;
  }
  active -= 1;
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

// Cloudflare serves the interstitial in the datacenter's language, and Byparr
// only recognizes the english title, so it reports those solves as successful.
// Catching it here is what keeps a challenge page from being parsed as content.
const CHALLENGE_TITLES =
  /<title>[^<]*(just a moment|um momento|un instant|un momento|einen augenblick|even geduld|attention required|checking your browser|silahkan tunggu|请稍候|잠시만)/i;
const CHALLENGE_MARKERS =
  /cf-browser-verification|id="challenge-form"|cf-challenge-running|_cf_chl_opt|Enable JavaScript and cookies to continue/i;

export function looksLikeChallenge(body: string): boolean {
  const head = body.slice(0, 4_000);
  const trimmed = head.trimStart();
  // A JSON payload is the answer we wanted, never an interstitial.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return CHALLENGE_TITLES.test(head) || CHALLENGE_MARKERS.test(head);
}

async function callSolver(
  solver: Solver,
  cmd: "request.get" | "request.post",
  url: string,
  postData: string | undefined,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = { cmd, url, maxTimeout: budgetMs };
  if (solver.kind === "byparr") {
    // Byparr binds only the snake_case field and reads it as seconds; the
    // camelCase one is dropped, which silently pins every solve to its default.
    body.max_timeout = Math.ceil(budgetMs / 1000);
    // Only the markup is ever parsed, so images and fonts are dead weight.
    body.blockMedia = true;
  } else if (postData !== undefined) {
    body.postData = postData;
  }

  // Never outlive the solver's own budget, or the request leaks a context.
  const own = AbortSignal.timeout(budgetMs + SOLVE_GRACE_MS);
  const res = await fetch(`${solver.url}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: signal ? AbortSignal.any([own, signal]) : own,
  });
  // A solver timeout answers 408 with a plain error body, not a solution.
  if (!res.ok) throw new Error(`solver_${res.status}`);
  const json = (await res.json()) as {
    status?: string;
    solution?: {
      response?: string;
      userAgent?: string;
      cookies?: { name: string; value: string }[];
    };
  };
  if (json.status !== "ok" || !json.solution?.response) throw new Error("solver_failed");

  const html = unwrapPre(json.solution.response);
  if (looksLikeChallenge(html)) throw new Error("solver_challenge");

  const cookies = json.solution.cookies ?? [];
  if (cookies.length && json.solution.userAgent) {
    clearances.set(hostOf(url), {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      userAgent: json.solution.userAgent,
      at: Date.now(),
    });
  }
  return html;
}

function solverOrder(host: string, cmd: "request.get" | "request.post"): Solver[] {
  const usable = cmd === "request.post" ? SOLVERS.filter((s) => s.kind === "flaresolverr") : SOLVERS;
  const win = preferred.get(host);
  // A solver the host keeps rejecting goes last instead of burning the budget
  // ahead of the one that still works there.
  const rank = (s: Solver) =>
    (isMuted(solverKey(s.kind, host)) ? 2 : 0) + (s.kind === win ? -1 : 0);
  return [...usable].sort((a, b) => rank(a) - rank(b));
}

// Win clearance for a host by solving its landing page, so the caller can
// replay the real request (including a POST) with a plain fetch.
export async function solveClearance(url: string): Promise<Clearance | null> {
  if (!flareEnabled()) return null;
  let landing = url;
  try {
    landing = new URL(url).origin + "/";
  } catch {
    /* keep the url as given */
  }
  await flareSolve("request.get", landing).catch(() => "");
  return getClearance(url);
}

// Solve through the configured solvers under the global limit. Concurrent
// callers asking for the same thing share one browser context. `budgetMs` is
// the caller's own patience: queue time and every attempt are charged to it,
// so the answer always lands before the caller walks away.
export async function flareSolve(
  cmd: "request.get" | "request.post",
  url: string,
  postData?: string,
  opts: { budgetMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  if (!flareEnabled()) throw new Error("solver_disabled");
  const host = hostOf(url);
  if (isMuted(breakerKey(host))) throw new Error("flare_host_muted");

  const order = solverOrder(host, cmd);
  if (!order.length) throw new Error("solver_no_post");

  const key = `${cmd}:${url}:${postData ?? ""}`;
  const shared = inflight.get(key);
  if (shared) return shared;

  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;

  const run = (async () => {
    await acquire(deadline, opts.signal);
    // Measured from here, not from the call: queue time is congestion on our
    // side and would show up as a slow source in the health ranking.
    const started = Date.now();
    try {
      let lastError: unknown = new Error("solver_failed");
      let attempts = 0;
      for (const solver of order) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) {
          lastError = new Error("solver_budget_exhausted");
          break;
        }
        try {
          attempts += 1;
          const budget = Math.min(FLARE_TIMEOUT, remaining - SOLVE_GRACE_MS);
          const html = await callSolver(solver, cmd, url, postData, budget, opts.signal);
          preferred.set(host, solver.kind);
          recordOk(solverKey(solver.kind, host), Date.now() - started);
          recordOk(breakerKey(host), Date.now() - started);
          return html;
        } catch (e) {
          // A caller that hung up says nothing about the solver or the host.
          if (opts.signal?.aborted) throw e;
          recordFail(solverKey(solver.kind, host));
          lastError = e;
        }
      }
      if (attempts) recordFail(breakerKey(host));
      throw lastError;
    } finally {
      release();
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, run);
  return run;
}
