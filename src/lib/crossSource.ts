// Reader neighbours that cross into another source of the same work when the
// open source has no next (or previous) chapter, or skipped one in the middle.

import { prisma } from "@/lib/db";
import {
  getCachedChapters,
  setCachedChapters,
  loadChaptersForLink,
  refreshChapters,
  revalidateChapters,
  type ChapterLink,
} from "@/lib/chapterCache";
import { dedupeByNumber, type RawChapter } from "@/lib/chapters";
import { findChapterMatch } from "@/lib/chapterMatch";

const MAX_SOURCES = 3;

export type Neighbour = {
  id: number;
  chapterNumber: number;
  sourceName: string | null;
  fromOtherSource: boolean;
};

type InSource = { id: number; chapterNumber: number } | null;

type Current = {
  id: number;
  name: string;
  chapterNumber: number;
  uploadDate: string | null;
};

// rank -1 is the chapter from the open source, 0+ is the source's position.
type Candidate = {
  id: number;
  chapterNumber: number;
  sourceName: string | null;
  rank: number;
};

function ownCandidate(n: InSource): Candidate | null {
  return n ? { id: n.id, chapterNumber: n.chapterNumber, sourceName: null, rank: -1 } : null;
}

function toNeighbour(c: Candidate | null): Neighbour | null {
  if (!c) return null;
  const other = c.rank >= 0;
  return {
    id: c.id,
    chapterNumber: c.chapterNumber,
    sourceName: other ? c.sourceName : null,
    fromOtherSource: other,
  };
}

// Smallest number still above the current one; unknown or backwards numbers
// never win, and candidates are already in preference order for ties.
function pickNext(candidates: Candidate[], current: number): Candidate | null {
  let best: Candidate | null = null;
  let bestKey = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const key =
      current > 0 && c.chapterNumber > current ? c.chapterNumber : Number.POSITIVE_INFINITY;
    if (!best || key < bestKey) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

function pickPrev(candidates: Candidate[], current: number): Candidate | null {
  let best: Candidate | null = null;
  let bestKey = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const key =
      current > 0 && c.chapterNumber > 0 && c.chapterNumber < current
        ? c.chapterNumber
        : Number.NEGATIVE_INFINITY;
    if (!best || key > bestKey) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

function ordered(chapters: RawChapter[]): RawChapter[] {
  if (!Array.isArray(chapters)) return [];
  return dedupeByNumber(chapters).sort((a, b) => a.chapterNumber - b.chapterNumber);
}

// Neighbour hunting runs inside the reader request, so a source is only asked
// for its list when that costs a local read. A Suwayomi miss refreshes in the
// background and offers no candidate this time around.
async function chaptersOf(link: ChapterLink): Promise<RawChapter[]> {
  try {
    const hit = await getCachedChapters<RawChapter[]>(link);
    if (hit) {
      if (hit.stale) revalidateChapters(link);
      return ordered(hit.data);
    }
    if (link.kind !== "scraper") {
      void refreshChapters(link);
      return [];
    }
    const chapters = await loadChaptersForLink(link);
    if (!Array.isArray(chapters)) return [];
    if (chapters.length) await setCachedChapters(link, chapters);
    return ordered(chapters);
  } catch {
    return [];
  }
}

export async function crossSourceNeighbours(input: {
  workId: number | null;
  mangaId: number;
  current: Current;
  inSourceNext: InSource;
  inSourcePrev: InSource;
}): Promise<{ next: Neighbour | null; prev: Neighbour | null }> {
  const own = {
    next: ownCandidate(input.inSourceNext),
    prev: ownCandidate(input.inSourcePrev),
  };
  const fallback = { next: toNeighbour(own.next), prev: toNeighbour(own.prev) };

  const cur = input.current.chapterNumber;
  const needNext = !input.inSourceNext || (cur > 0 && input.inSourceNext.chapterNumber - cur > 1);
  const needPrev = !input.inSourcePrev || (cur > 0 && cur - input.inSourcePrev.chapterNumber > 1);
  if (!input.workId || (!needNext && !needPrev)) return fallback;

  try {
    const links = (
      await prisma.sourceLink.findMany({
        where: { workId: input.workId },
        orderBy: [{ isPrimary: "desc" }, { healthScore: "desc" }],
      })
    )
      .filter((l) => l.sourceMangaId !== input.mangaId && l.chapterCount > 0)
      .slice(0, MAX_SOURCES);
    if (!links.length) return fallback;

    const lists = await Promise.all(links.map((link) => chaptersOf(link)));

    const nextCandidates: Candidate[] = own.next ? [own.next] : [];
    const prevCandidates: Candidate[] = own.prev ? [own.prev] : [];

    lists.forEach((list, rank) => {
      if (!list.length) return;
      const sourceName = links[rank].sourceName ?? null;
      const equivalent = findChapterMatch(input.current, list);
      const idx = equivalent ? list.findIndex((c) => c.id === equivalent.id) : -1;

      if (needNext) {
        const after =
          idx >= 0
            ? (list[idx + 1] ?? null)
            : cur > 0
              ? (list.find((c) => c.chapterNumber > cur) ?? null)
              : null;
        if (after && after.id !== input.current.id) {
          nextCandidates.push({
            id: after.id,
            chapterNumber: after.chapterNumber,
            sourceName,
            rank,
          });
        }
      }

      if (needPrev) {
        let before: RawChapter | null = null;
        if (idx >= 0) {
          before = idx > 0 ? list[idx - 1] : null;
        } else if (cur > 0) {
          for (const c of list) {
            if (c.chapterNumber > 0 && c.chapterNumber < cur) before = c;
          }
        }
        if (before && before.id !== input.current.id) {
          prevCandidates.push({
            id: before.id,
            chapterNumber: before.chapterNumber,
            sourceName,
            rank,
          });
        }
      }
    });

    return {
      next: needNext ? toNeighbour(pickNext(nextCandidates, cur)) : fallback.next,
      prev: needPrev ? toNeighbour(pickPrev(prevCandidates, cur)) : fallback.prev,
    };
  } catch {
    return fallback;
  }
}
