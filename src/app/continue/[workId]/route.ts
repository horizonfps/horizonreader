import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getPrimaryLink } from "@/lib/backbone/resolve";
import { getCachedChapters, setCachedChapters, loadChaptersForLink } from "@/lib/chapterCache";
import { groupByScanlator, dedupeByNumber, type RawChapter } from "@/lib/chapters";
import { pickResumeChapter } from "@/lib/continueReading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resolves "Continuar" server-side so the home strip can link a work without
// loading every work's chapter list while rendering.
export async function GET(req: NextRequest, { params }: { params: Promise<{ workId: string }> }) {
  const { workId: raw } = await params;
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));

  const session = await getSession();
  if (!session) return to("/login");

  const workId = Number(raw);
  const work = Number.isInteger(workId)
    ? await prisma.work.findUnique({ where: { id: workId } }).catch(() => null)
    : null;
  if (!work) return to("/");

  const workPath = `/work/${encodeURIComponent(work.slug)}`;

  const progress = await prisma.progress
    .findMany({ where: { userId: session.uid, workId } })
    .catch(() => []);
  if (!progress.length) return to(workPath);

  const anchor = progress.reduce((best, row) =>
    row.chapterNumber > best.chapterNumber ||
    (row.chapterNumber === best.chapterNumber && row.updatedAt.getTime() > best.updatedAt.getTime())
      ? row
      : best,
  );

  const link =
    (await prisma.sourceLink
      .findFirst({ where: { workId, sourceMangaId: anchor.mangaId } })
      .catch(() => null)) ?? (await getPrimaryLink(workId));
  if (!link) return to(workPath);

  let chapters: RawChapter[] = [];
  const hit = await getCachedChapters<RawChapter[]>(link);
  if (hit) {
    chapters = hit.data;
  } else {
    chapters = await loadChaptersForLink(link);
    if (chapters.length) await setCachedChapters(link, chapters);
  }
  if (!chapters.length) return to(workPath);

  const groups = groupByScanlator(chapters);
  const group = groups.find((g) => g.chapters.some((c) => c.id === anchor.chapterId)) ?? groups[0];
  if (!group) return to(workPath);
  const ascending = dedupeByNumber(group.chapters).sort((a, b) => a.chapterNumber - b.chapterNumber);

  const target = pickResumeChapter(ascending, progress);
  if (!target) return to(workPath);
  return to(`/reader/${target.chapterId}`);
}
