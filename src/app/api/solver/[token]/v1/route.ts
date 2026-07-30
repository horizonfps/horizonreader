// FlareSolverr-shaped facade over our solver pool, so Suwayomi (which accepts a
// single FLARESOLVERR_URL) gets the same two-engine fallback and challenge
// detection the app's own scrapers get.
//
// Point Suwayomi at http://web:3000/api/solver/<SOLVER_PROXY_TOKEN>; the token
// lives in the path because Suwayomi appends "/v1" and sends no custom headers.

import { NextRequest, NextResponse } from "next/server";
import { flareEnabled, flareSolve, getClearance } from "@/lib/scrapers/flare";

export const runtime = "nodejs";

// setUserAgent(solution.userAgent) is global in Suwayomi, not per host, so an
// empty string here would blank the engine's identity for every source.
const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const TOKEN = process.env.SOLVER_PROXY_TOKEN || "";

// Suwayomi drops the call at its own flareSolverrTimeout and logs a stack
// trace; a solve that lands after that only burned a browser context. The
// caller's maxTimeout is the budget, minus the room to send the answer back.
const CALLER_GRACE_MS = 5_000;
const MAX_BUDGET_MS = Number(process.env.SOLVER_PROXY_BUDGET_MS || 60_000);
const MIN_BUDGET_MS = 15_000;

function budgetFrom(raw: unknown): number {
  const asked = Number(raw);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_BUDGET_MS) : MAX_BUDGET_MS;
  return Math.max(MIN_BUDGET_MS, limit - CALLER_GRACE_MS);
}

// Never let a caller aim the solver at the private network.
const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

function ok(body: Record<string, unknown>) {
  return NextResponse.json({
    status: "ok",
    message: "",
    startTimestamp: Date.now(),
    endTimestamp: Date.now(),
    version: "horizon-solver/1",
    ...body,
  });
}

function fail(message: string, status = 500) {
  return NextResponse.json(
    { status: "error", message, startTimestamp: Date.now(), endTimestamp: Date.now() },
    { status },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN || token !== TOKEN) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!flareEnabled()) return fail("no solver configured", 503);

  let body: { cmd?: string; url?: string; postData?: string; maxTimeout?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("bad request", 400);
  }

  const cmd = body.cmd || "request.get";
  // Sessions are a no-op here: every solve already reuses per-host clearance.
  if (cmd.startsWith("sessions.")) {
    return ok(cmd === "sessions.list" ? { sessions: [] } : { session: "horizon" });
  }
  if (cmd !== "request.get" && cmd !== "request.post") return fail(`unknown cmd ${cmd}`, 400);

  const target = (body.url || "").trim();
  let host = "";
  try {
    const u = new URL(target);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    host = u.hostname;
  } catch {
    return fail("bad url", 400);
  }
  if (PRIVATE_HOST.test(host)) return fail("host not allowed", 400);

  try {
    const html = await flareSolve(cmd, target, cmd === "request.post" ? body.postData : undefined, {
      budgetMs: budgetFrom(body.maxTimeout),
      signal: req.signal,
    });
    const clearance = getClearance(target);
    const cookies = clearance
      ? clearance.cookie.split("; ").flatMap((pair) => {
          const i = pair.indexOf("=");
          if (i <= 0) return [];
          return [{ name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: "/" }];
        })
      : [];
    return ok({
      // No cookie for this host means no challenge was actually seen, so tell
      // Suwayomi "not detected" instead of "resolved": it then uses this HTML
      // as-is instead of replaying the original request with no cookie, which
      // would just draw the same 403 again.
      ...(cookies.length ? {} : { message: "Challenge not detected" }),
      solution: {
        url: target,
        status: 200,
        cookies,
        userAgent: clearance?.userAgent || FALLBACK_UA,
        headers: {},
        response: html,
      },
    });
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e), 500);
  }
}
