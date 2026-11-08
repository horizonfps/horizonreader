import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { inviteExpiry, MAX_PENDING_INVITES, newInviteCode, pendingInviteCount } from "@/lib/invites";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!session.isAdmin && (await pendingInviteCount(session.uid)) >= MAX_PENDING_INVITES) {
    return NextResponse.json({ error: "limit_reached" }, { status: 409 });
  }

  const invite = await prisma.invite.create({
    data: { code: newInviteCode(), createdById: session.uid, expiresAt: inviteExpiry() },
  });
  return NextResponse.json({
    invite: { id: invite.id, code: invite.code, expiresAt: invite.expiresAt.toISOString() },
  });
}

// DELETE ?id=  revokes one of the caller's unused invites.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const { count } = await prisma.invite.deleteMany({
    where: { id, createdById: session.uid, usedAt: null },
  });
  return NextResponse.json({ ok: count === 1 });
}
