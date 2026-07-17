import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { addToLibrary, removeFromLibrary } from "@/lib/suwayomi";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const follows = await prisma.follow.findMany({
    where: { userId: session.uid },
    select: { mangaId: true },
  });
  return NextResponse.json({ mangaIds: follows.map((f) => f.mangaId) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const mangaId = Number(body?.mangaId);
  const follow = Boolean(body?.follow);
  if (!Number.isInteger(mangaId)) {
    return NextResponse.json({ error: "bad_manga_id" }, { status: 400 });
  }

  try {
    if (follow) {
      await prisma.follow.upsert({
        where: { userId_mangaId: { userId: session.uid, mangaId } },
        create: { userId: session.uid, mangaId },
        update: {},
      });
      // Back the follow with Suwayomi's library so scheduled updates fetch new
      // chapters for this title.
      await addToLibrary(mangaId).catch(() => {});
    } else {
      // Delete and recount atomically so concurrent unfollows settle on the
      // right library membership.
      const others = await prisma.$transaction(async (tx) => {
        await tx.follow.deleteMany({ where: { userId: session.uid, mangaId } });
        return tx.follow.count({ where: { mangaId } });
      });
      if (others === 0) await removeFromLibrary(mangaId).catch(() => {});
    }
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  return NextResponse.json({ following: follow });
}
