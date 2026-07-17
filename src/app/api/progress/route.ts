import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// GET /api/progress            -> latest in-progress chapters (continue reading)
// GET /api/progress?mangaId=1  -> progress for every read chapter of a manga
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const mangaIdParam = req.nextUrl.searchParams.get("mangaId");

  if (mangaIdParam) {
    const mangaId = Number(mangaIdParam);
    const rows = await prisma.progress.findMany({
      where: { userId: session.uid, mangaId },
    });
    return NextResponse.json({
      chapters: rows.map((r) => ({
        chapterId: r.chapterId,
        lastPageRead: r.lastPageRead,
        read: r.read,
      })),
    });
  }

  const recent = await prisma.progress.findMany({
    where: { userId: session.uid, read: false, lastPageRead: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ items: recent });
}

// POST { mangaId, chapterId, lastPageRead?, read?, workId?, chapterNumber? }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const mangaId = Number(body?.mangaId);
  const chapterId = Number(body?.chapterId);
  if (!Number.isInteger(mangaId) || !Number.isInteger(chapterId)) {
    return NextResponse.json({ error: "bad_ids" }, { status: 400 });
  }

  const lastPageRead = Number.isInteger(body?.lastPageRead) ? Number(body.lastPageRead) : 0;
  const read = Boolean(body?.read);
  const workId =
    typeof body?.workId === "number" && Number.isInteger(body.workId) ? body.workId : null;
  const chapterNumber =
    typeof body?.chapterNumber === "number" && Number.isFinite(body.chapterNumber)
      ? body.chapterNumber
      : null;

  const extra: { workId?: number; chapterNumber?: number } = {};
  if (workId != null) extra.workId = workId;
  if (chapterNumber != null) extra.chapterNumber = chapterNumber;

  try {
    await prisma.progress.upsert({
      where: { userId_chapterId: { userId: session.uid, chapterId } },
      create: { userId: session.uid, mangaId, chapterId, lastPageRead, read, ...extra },
      update: { lastPageRead, read, ...extra },
    });

    // Record a reading event once we have a canonical work and real progress.
    // updateMany-then-create keeps concurrent saves from stacking duplicates.
    if (workId != null && (read || lastPageRead > 0)) {
      const data = { chapterNumber: chapterNumber ?? 0, lastPageRead, readAt: new Date() };
      const updated = await prisma.readingHistory.updateMany({
        where: { userId: session.uid, workId, chapterId },
        data,
      });
      if (updated.count === 0) {
        await prisma.readingHistory
          .create({ data: { userId: session.uid, workId, chapterId, ...data } })
          .catch(() => {});
      }
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
