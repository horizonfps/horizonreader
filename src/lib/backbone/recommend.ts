// "Horizon Recomenda" assembly: admin-curated picks pinned first, then
// top-rated MangaDex picks biased toward the user's favorite genres, hiding
// titles already in their library. Server-side only.

import { prisma } from "@/lib/db";
import { listMangaDex } from "@/lib/backbone/mangadex";
import { resolveGenreTag } from "@/lib/backbone/tags";
import { isBlocked } from "@/lib/backbone/filter";
import { backboneToCard } from "@/lib/cards";
import type { SectionItem, WorkStatus, WorkType } from "@/lib/backbone/types";

const CAP = 30;
const TTL = 60 * 60 * 1000;
const TOP_GENRES = 3;

// Keyed by the resolved tag set so users with the same taste share entries.
const cache = new Map<string, { data: SectionItem[]; at: number }>();

function parseGenres(json?: string | null): string[] {
  if (!json) return [];
  try {
    const g = JSON.parse(json);
    return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

function coerceType(t?: string | null): WorkType | null {
  return t === "manga" || t === "manhwa" || t === "manhua" || t === "other" ? t : null;
}
function coerceStatus(s?: string | null): WorkStatus | null {
  return s === "ongoing" || s === "completed" || s === "hiatus" || s === "cancelled" || s === "unknown"
    ? s
    : null;
}

// Curated picks always show, newest first, linking straight to the local work.
async function getCuratedPicks(): Promise<SectionItem[]> {
  const picks = await prisma.horizonPick.findMany({
    orderBy: { createdAt: "desc" },
    take: CAP,
    include: { work: true },
  });
  return picks
    .filter((p) => p.work)
    .map((p) => ({
      origin: p.work.origin === "comick" ? ("comick" as const) : ("mangadex" as const),
      externalId: p.work.externalId,
      slug: null,
      localSlug: p.work.slug,
      title: p.work.title,
      coverUrl: p.work.coverUrl,
      type: coerceType(p.work.type),
      status: coerceStatus(p.work.status),
      rating: p.work.rating,
      chapterCount: null,
      genres: [],
      contentRating: p.work.contentRating,
    }));
}

export async function getHorizonPicks(userId: number): Promise<SectionItem[]> {
  try {
    const curated = await getCuratedPicks().catch(() => [] as SectionItem[]);
    const favs = await prisma.favorite.findMany({
      where: { userId },
      select: { work: { select: { origin: true, externalId: true, genres: true } } },
      take: 200,
    });

    const counts = new Map<string, number>();
    const owned = new Set<string>();
    for (const f of favs) {
      if (!f.work) continue;
      owned.add(`${f.work.origin}:${f.work.externalId}`);
      for (const g of parseGenres(f.work.genres)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const topGenres = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_GENRES)
      .map(([g]) => g);

    const tags = (
      await Promise.all(topGenres.map((g) => resolveGenreTag(g).catch(() => null)))
    ).filter((t): t is string => !!t);

    const key = tags.length ? [...tags].sort().join(",") : "all";
    const now = Date.now();
    const hit = cache.get(key);
    let items: SectionItem[];
    if (hit && now - hit.at < TTL) {
      items = hit.data;
    } else {
      const works = await listMangaDex({
        includedTags: tags.length ? tags : undefined,
        order: { rating: "desc" },
        hasAvailableChapters: true,
        limit: CAP * 2,
      });
      items = works
        .map(backboneToCard)
        .filter((it) => !isBlocked({ genres: it.genres, contentRating: it.contentRating }));
      if (items.length) cache.set(key, { data: items, at: now });
    }

    const curatedKeys = new Set(curated.map((it) => `${it.origin}:${it.externalId}`));
    const algo = items.filter(
      (it) =>
        !owned.has(`${it.origin}:${it.externalId}`) &&
        !curatedKeys.has(`${it.origin}:${it.externalId}`),
    );
    return [...curated, ...algo].slice(0, CAP);
  } catch {
    return [];
  }
}
