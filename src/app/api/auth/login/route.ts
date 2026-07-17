import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPasswordConstantTime } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/jwt";

export const runtime = "nodejs";

// In-memory fixed-window rate limiter. Keyed by client IP and by target
// username, so spoofing X-Forwarded-For alone cannot brute-force one account.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 15;
const MAX_PER_USER = 10;
const MAX_KEYS = 5000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function pruneExpired(now: number) {
  if (attempts.size < MAX_KEYS) return;
  for (const [k, v] of attempts) {
    if (now > v.resetAt) attempts.delete(k);
  }
}

function rateLimited(key: string, max: number): boolean {
  const now = Date.now();
  pruneExpired(now);
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function clientKey(req: NextRequest): string {
  // cf-connecting-ip is set by Cloudflare (the expected deploy front).
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  return `ip:${ip.toLowerCase()}`;
}

function cookieSecure(): boolean {
  const flag = process.env.COOKIE_SECURE;
  if (flag != null) return flag === "true";
  return process.env.NODE_ENV === "production";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const username = body?.username;
  const password = body?.password;

  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }

  const ipLimited = rateLimited(clientKey(req), MAX_PER_IP);
  const userLimited = rateLimited(`user:${username.toLowerCase()}`, MAX_PER_USER);
  if (ipLimited || userLimited) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await verifyPasswordConstantTime(password, user?.passwordHash ?? null);

  if (!user || !ok) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await createSessionToken({
    uid: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
