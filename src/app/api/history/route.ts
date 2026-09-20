import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// DELETE ?id=<row> removes one entry; without id the whole history goes.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  const where = Number.isInteger(id) && id > 0 ? { userId: session.uid, id } : { userId: session.uid };
  const { count } = await prisma.readingHistory.deleteMany({ where }).catch(() => ({ count: 0 }));
  return NextResponse.json({ ok: true, removed: count });
}
