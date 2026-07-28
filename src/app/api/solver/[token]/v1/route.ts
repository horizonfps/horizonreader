// FlareSolverr-shaped facade over our solver pool, so Suwayomi (which accepts a
// single FLARESOLVERR_URL) gets the same two-engine fallback and challenge
// detection the app's own scrapers get.
//
// Point Suwayomi at http://web:3000/api/solver/<SOLVER_PROXY_TOKEN>; the token
// lives in the path because Suwayomi appends "/v1" and sends no custom headers.

import { NextRequest, NextResponse } from "next/server";
import { flareEnabled, flareSolve, getClearance } from "@/lib/scrapers/flare";

export const runtime = "nodejs";

const TOKEN = process.env.SOLVER_PROXY_TOKEN || "";

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

  let body: { cmd?: string; url?: string; postData?: string };
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
    const html = await flareSolve(cmd, target, cmd === "request.post" ? body.postData : undefined);
    const clearance = getClearance(target);
    return ok({
      solution: {
        url: target,
        status: 200,
        cookies: clearance
          ? clearance.cookie.split("; ").flatMap((pair) => {
              const i = pair.indexOf("=");
              if (i <= 0) return [];
              return [{ name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: "/" }];
            })
          : [],
        userAgent: clearance?.userAgent ?? "",
        headers: {},
        response: html,
      },
    });
  } catch (e) {
    return fail(String(e instanceof Error ? e.message : e), 500);
  }
}
