import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isStorableId } from "@/lib/downloads";

export const runtime = "nodejs";

function quotaOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const userId = Number(body?.userId);
  if (!isStorableId(userId) || userId <= 0) {
    return NextResponse.json({ error: "bad_ids" }, { status: 400 });
  }

  const quotaMb = quotaOf(body?.quotaMb);
  try {
    await prisma.user.update({ where: { id: userId }, data: { downloadQuotaMb: quotaMb } });
  } catch {
    return NextResponse.json({ error: "bad_ids" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, userId, quotaMb });
}
