// Finishing a chapter implies every earlier chapter of the same scan group was
// already read, so the work page stops looking full of holes.

import { prisma } from "@/lib/db";
import { getCachedChapters, setCachedChapters, loadChaptersForLink } from "@/lib/chapterCache";
import { groupByScanlator, dedupeByNumber, type RawChapter } from "@/lib/chapters";

const MAX_AUTO_READ = 500;

export async function markSkippedAsRead(input: {
  userId: number;
  mangaId: number;
  chapterId: number;
  workId: number | null;
  chapterNumber: number | null;
}): Promise<number> {
  try {
    const link = await prisma.sourceLink
      .findFirst({ where: { sourceMangaId: input.mangaId } })
      .catch(() => null);
    if (!link) return 0;

    let chapters: RawChapter[] = [];
    const hit = await getCachedChapters<RawChapter[]>(link);
    if (hit) {
      chapters = hit.data;
    } else {
      chapters = await loadChaptersForLink(link);
      if (chapters.length) await setCachedChapters(link, chapters);
    }
    if (!Array.isArray(chapters) || !chapters.length) return 0;

    const groups = groupByScanlator(chapters);
    const group =
      groups.find((g) => g.chapters.some((c) => c.id === input.chapterId)) ?? groups[0];
    if (!group) return 0;
    const list = dedupeByNumber(group.chapters);

    const currentRow = list.find((c) => c.id === input.chapterId);
    const current = currentRow ? currentRow.chapterNumber : (input.chapterNumber ?? 0);
    if (!(current > 0)) return 0;

    const candidates = list
      .filter((c) => c.id !== input.chapterId && c.chapterNumber > 0 && c.chapterNumber < current)
      .sort((a, b) => b.chapterNumber - a.chapterNumber)
      .slice(0, MAX_AUTO_READ);
    if (!candidates.length) return 0;

    const ids = candidates.map((c) => c.id);
    const existing = await prisma.progress.findMany({
      where: { userId: input.userId, chapterId: { in: ids } },
      select: { chapterId: true },
    });
    const seen = new Set(existing.map((r) => r.chapterId));

    const data = candidates
      .filter((c) => !seen.has(c.id))
      .map((c) => ({
        userId: input.userId,
        workId: input.workId ?? link.workId,
        mangaId: input.mangaId,
        chapterId: c.id,
        chapterNumber: c.chapterNumber,
        lastPageRead: 0,
        read: true,
      }));
    if (!data.length) return 0;

    const created = await prisma.progress.createMany({ data });
    return created.count;
  } catch {
    return 0;
  }
}
