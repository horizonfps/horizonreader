import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/authCookie";
import { clientKey, createRateLimiter } from "@/lib/rateLimit";
import { findUsableInvite, isValidUsername, PASSWORD_MIN, usernameTaken } from "@/lib/invites";

export const runtime = "nodejs";

const MAX_PER_IP = 10;
const rateLimited = createRateLimiter(60 * 60 * 1000);

// POST { code, username, password } -> creates the account and signs it in.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (rateLimited(clientKey(req), MAX_PER_IP)) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "bad_username" }, { status: 400 });
  }
  if (password.length < PASSWORD_MIN || password.length > 128) {
    return NextResponse.json({ error: "bad_password" }, { status: 400 });
  }

  const invite = await findUsableInvite(code);
  if (!invite) return NextResponse.json({ error: "invalid_invite" }, { status: 410 });
  if (await usernameTaken(username)) {
    return NextResponse.json({ error: "username_taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { username, passwordHash } });
      // Conditional claim: a concurrent signup on the same code rolls back here.
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null, usedById: null, expiresAt: { gt: new Date() } },
        data: { usedById: created.id, usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("INVITE_RACE");
      return created;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVITE_RACE") {
      return NextResponse.json({ error: "invalid_invite" }, { status: 410 });
    }
    return NextResponse.json({ error: "username_taken" }, { status: 409 });
  }

  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, { uid: user.id, username: user.username, isAdmin: user.isAdmin });
  return res;
}
