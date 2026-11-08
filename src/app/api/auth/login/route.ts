import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPasswordConstantTime } from "@/lib/password";
import { setSessionCookie } from "@/lib/authCookie";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Keyed by client IP and by target username, so spoofing X-Forwarded-For
// alone cannot brute-force one account.
const MAX_PER_IP = 15;
const MAX_PER_USER = 10;
const rateLimited = createRateLimiter(15 * 60 * 1000);

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

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, { uid: user.id, username: user.username, isAdmin: user.isAdmin });
  return res;
}
