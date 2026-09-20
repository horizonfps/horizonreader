import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const MAX = 2_000;
// Marks set by hand carry -1 so they never count as app-filled auto reads.
const MANUAL_PAGE = -1;

type Item = { chapterId: number; chapterNumber?: number };

// POST { mangaId, workId?, read, chapters: [{ chapterId, chapterNumber? }] }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const mangaId = Number(body?.mangaId);
  const read = Boolean(body?.read);
  const workId =
    typeof body?.workId === "number" && Number.isInteger(body.workId) ? body.workId : null;
  const raw: unknown = body?.chapters;
  if (!Number.isInteger(mangaId) || !Array.isArray(raw) || !raw.length) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const chapters: Item[] = raw
    .slice(0, MAX)
    .map((c: any) => ({
      chapterId: Number(c?.chapterId),
      chapterNumber: Number.isFinite(Number(c?.chapterNumber)) ? Number(c.chapterNumber) : 0,
    }))
    .filter((c) => Number.isInteger(c.chapterId));
  if (!chapters.length) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    if (!read) {
      const result = await prisma.progress.deleteMany({
        where: { userId: session.uid, chapterId: { in: chapters.map((c) => c.chapterId) } },
      });
      return NextResponse.json({ ok: true, changed: result.count });
    }
    const existing = await prisma.progress.findMany({
      where: { userId: session.uid, chapterId: { in: chapters.map((c) => c.chapterId) } },
      select: { chapterId: true, read: true },
    });
    const byId = new Map(existing.map((r) => [r.chapterId, r]));
    const toCreate = chapters.filter((c) => !byId.has(c.chapterId));
    const toUpdate = chapters.filter((c) => byId.get(c.chapterId)?.read === false);
    let changed = 0;
    if (toCreate.length) {
      const created = await prisma.progress.createMany({
        data: toCreate.map((c) => ({
          userId: session.uid,
          mangaId,
          workId,
          chapterId: c.chapterId,
          chapterNumber: c.chapterNumber ?? 0,
          lastPageRead: MANUAL_PAGE,
          read: true,
        })),
      });
      changed += created.count;
    }
    if (toUpdate.length) {
      const updated = await prisma.progress.updateMany({
        where: { userId: session.uid, chapterId: { in: toUpdate.map((c) => c.chapterId) } },
        data: { read: true, lastPageRead: MANUAL_PAGE },
      });
      changed += updated.count;
    }
    return NextResponse.json({ ok: true, changed });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
