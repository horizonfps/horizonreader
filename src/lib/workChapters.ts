// Everything the chapter list of one source needs, in one JSON-safe shape, so
// the work page and /api/work-chapters answer with exactly the same payload.

import { prisma } from "@/lib/db";
import {
  getCachedChapters,
  loadChaptersForLink,
  refreshChapters,
  revalidateChapters,
  type ChapterLink,
} from "@/lib/chapterCache";
import { groupByScanlator, dedupeByNumber, type RawChapter } from "@/lib/chapters";
import { findChapterMatch } from "@/lib/chapterMatch";
import type { DownloadStatus } from "@/components/DownloadButton";

export type ChapterView = {
  id: number;
  name: string;
  chapterNumber: number;
  uploadDate: string | null;
};

export type GroupView = { key: string; count: number; chapters: ChapterView[] };

export type ProgressView = {
  chapterId: number;
  read: boolean;
  lastPageRead: number;
  updatedAt: number;
};

export type SourceView = {
  linkId: number;
  sourceMangaId: number;
  sourceName: string;
  groups: GroupView[];
  progress: ProgressView[];
  downloadStatus: [number, DownloadStatus][];
  mirrored: [number, number][];
  autoReadCount: number;
};

export type ViewLink = {
  id: number;
  workId: number;
  kind: string | null;
  sourceId: string | null;
  sourceMangaId: number;
  sourceName: string | null;
};

const DEFAULT_BUDGET_MS = 8_000;
const MIRROR_LINKS = 4;

function toView(c: RawChapter): ChapterView {
  return {
    id: c.id,
    name: c.name,
    chapterNumber: c.chapterNumber,
    uploadDate: c.uploadDate ?? null,
  };
}

// Local-only read: the cache tiers, plus the scraper table (a db read, never
// the network). Used to pool chapters of the other sources of the same work.
async function readWithoutNetwork(link: ChapterLink): Promise<RawChapter[]> {
  const hit = await getCachedChapters<RawChapter[]>(link).catch(() => null);
  if (hit) return hit.data;
  if (link.kind !== "scraper") return [];
  return loadChaptersForLink(link).catch(() => []);
}

// Fetches through refreshChapters so concurrent pollers of the same link share
// one request; a timeout leaves it running and the next poll picks up the cache.
async function loadWithinBudget(link: ChapterLink, budgetMs: number): Promise<RawChapter[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });
  const landed = await Promise.race([
    refreshChapters(link).then(
      () => true,
      () => true,
    ),
    deadline,
  ]);
  clearTimeout(timer);
  if (!landed) return null;
  const hit = await getCachedChapters<RawChapter[]>(link).catch(() => null);
  return hit?.data.length ? hit.data : null;
}

export async function buildSourceView(
  link: ViewLink,
  opts: { uid: number | null; budgetMs?: number },
): Promise<SourceView | null> {
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  let chapters: RawChapter[] | null = null;
  const hit = await getCachedChapters<RawChapter[]>(link).catch(() => null);
  if (hit) {
    chapters = hit.data;
    if (hit.stale) revalidateChapters(link);
  } else {
    chapters = await loadWithinBudget(link, budgetMs).catch(() => null);
    if (!chapters || !chapters.length) {
      void refreshChapters(link);
      return null;
    }
  }

  const groups: GroupView[] = groupByScanlator(chapters).map((g) => {
    const list = dedupeByNumber(g.chapters)
      .sort((a, b) => b.chapterNumber - a.chapterNumber)
      .map(toView);
    return { key: g.key, count: list.length, chapters: list };
  });

  const allChapters = groups.flatMap((g) => g.chapters);
  const chapterIds = new Set(allChapters.map((c) => c.id));

  const progressRows = opts.uid
    ? await prisma.progress
        .findMany({ where: { userId: opts.uid, mangaId: link.sourceMangaId } })
        .catch(() => [])
    : [];
  const progress: ProgressView[] = progressRows
    .filter((row) => chapterIds.has(row.chapterId))
    .map((row) => ({
      chapterId: row.chapterId,
      read: row.read,
      lastPageRead: row.lastPageRead,
      updatedAt: row.updatedAt.getTime(),
    }));

  const downloads = await prisma.chapterDownload
    .findMany({
      where: { workId: link.workId },
      select: { chapterId: true, chapterNumber: true, mangaId: true, status: true },
    })
    .catch(() => []);
  const downloadStatus: [number, DownloadStatus][] = downloads.map((row) => [
    row.chapterId,
    row.status as DownloadStatus,
  ]);
  const ownStatus = new Map<number, DownloadStatus>(downloadStatus);

  const doneIds = new Set(downloads.filter((r) => r.status === "DONE").map((r) => r.chapterId));
  const doneMangaIds = new Set(
    downloads.filter((r) => r.status === "DONE").map((r) => r.mangaId),
  );
  const mirrored: [number, number][] = [];
  if (doneIds.size) {
    const siblings = (
      await prisma.sourceLink.findMany({ where: { workId: link.workId } }).catch(() => [])
    )
      .filter((other) => other.id !== link.id && doneMangaIds.has(other.sourceMangaId))
      .slice(0, MIRROR_LINKS);
    const pools = await Promise.all(siblings.map((other) => readWithoutNetwork(other)));
    const elsewhere = pools.flat().filter((c) => doneIds.has(c.id));
    if (elsewhere.length) {
      for (const chapter of allChapters) {
        if (ownStatus.get(chapter.id) === "DONE") continue;
        const match = findChapterMatch(chapter, elsewhere);
        if (match) mirrored.push([chapter.id, match.id]);
      }
    }
  }

  const autoReadCount = opts.uid
    ? await prisma.progress
        .count({
          where: {
            userId: opts.uid,
            read: true,
            lastPageRead: 0,
            OR: [{ workId: link.workId }, { mangaId: link.sourceMangaId }],
          },
        })
        .catch(() => 0)
    : 0;

  return {
    linkId: link.id,
    sourceMangaId: link.sourceMangaId,
    sourceName: link.sourceName || "Fonte",
    groups,
    progress,
    downloadStatus,
    mirrored,
    autoReadCount,
  };
}
