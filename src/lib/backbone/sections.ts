// Home-page section assembly. Comick /top primary, MangaDex fallback. Server-side only.

import { comickSections, getComickGenres, getComickTrending } from "@/lib/backbone/comick";
import { listMangaDex } from "@/lib/backbone/mangadex";
import type { BackboneWork, SectionItem } from "@/lib/backbone/types";

const CAP = 24;
const TTL = 60 * 60 * 1000;

export type HomeSections = {
  popular: { "30d": SectionItem[]; "6m": SectionItem[]; "12m": SectionItem[]; all: SectionItem[] };
  completed: { "7d": SectionItem[]; "30d": SectionItem[]; "12m": SectionItem[] };
  bestNew: SectionItem[];
};

type Genre = { name: string; slug: string; group: string };

let sectionsCache: { data: HomeSections; at: number } | null = null;
let genresCache: { data: Genre[]; at: number } | null = null;

// Minimal set so the browse UI always has something when Comick is down.
const FALLBACK_GENRES: Genre[] = [
  { name: "Action", slug: "action", group: "Genre" },
  { name: "Adventure", slug: "adventure", group: "Genre" },
  { name: "Comedy", slug: "comedy", group: "Genre" },
  { name: "Drama", slug: "drama", group: "Genre" },
  { name: "Fantasy", slug: "fantasy", group: "Genre" },
  { name: "Horror", slug: "horror", group: "Genre" },
  { name: "Mystery", slug: "mystery", group: "Genre" },
  { name: "Psychological", slug: "psychological", group: "Genre" },
  { name: "Romance", slug: "romance", group: "Genre" },
  { name: "Sci-Fi", slug: "sci-fi", group: "Genre" },
  { name: "Slice of Life", slug: "slice-of-life", group: "Genre" },
  { name: "Sports", slug: "sports", group: "Genre" },
  { name: "Supernatural", slug: "supernatural", group: "Genre" },
  { name: "Thriller", slug: "thriller", group: "Genre" },
];

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

// De-dup by (origin + slug/externalId) and cap the row.
function dedupCap(items: SectionItem[]): SectionItem[] {
  const seen = new Set<string>();
  const out: SectionItem[] = [];
  for (const it of items) {
    if (!it) continue;
    const key = `${it.origin}:${it.slug || it.externalId}`;
    if (!it.slug && !it.externalId) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= CAP) break;
  }
  return out;
}

function workToItem(w: BackboneWork): SectionItem {
  return {
    origin: "mangadex",
    externalId: w.externalId,
    slug: null,
    title: w.title,
    coverUrl: w.coverUrl ?? null,
    type: w.type ?? null,
    status: w.status ?? null,
    rating: w.rating ?? null,
    chapterCount: null,
  };
}

function emptySections(): HomeSections {
  return {
    popular: { "30d": [], "6m": [], "12m": [], all: [] },
    completed: { "7d": [], "30d": [], "12m": [] },
    bestNew: [],
  };
}

function hasAny(s: HomeSections): boolean {
  const p = s.popular;
  const c = s.completed;
  return (
    p["30d"].length > 0 ||
    p["6m"].length > 0 ||
    p["12m"].length > 0 ||
    p.all.length > 0 ||
    c["7d"].length > 0 ||
    c["30d"].length > 0 ||
    c["12m"].length > 0 ||
    s.bestNew.length > 0
  );
}

export async function getHomeSections(): Promise<HomeSections> {
  const now = Date.now();
  if (sectionsCache && now - sectionsCache.at < TTL) return sectionsCache.data;

  try {
    const [sections, trend6m, trend12m] = await Promise.all([
      safe(comickSections(), {
        trending: {} as Record<string, SectionItem[]>,
        popularAllTime: [] as SectionItem[],
        bestNew: [] as SectionItem[],
        completions: [] as SectionItem[],
      }),
      safe(getComickTrending({ day: 180 }), [] as SectionItem[]),
      safe(getComickTrending({ day: 365 }), [] as SectionItem[]),
    ]);

    const popular = {
      "30d": dedupCap(sections.trending?.["30"] ?? []),
      "6m": dedupCap(trend6m),
      "12m": dedupCap(trend12m),
      all: dedupCap(sections.popularAllTime ?? []),
    };

    // Comick completions carry no per-window date, so they fill 30d only;
    // MangaDex recently-updated completed backfills 7d and 12m.
    const comickCompletions = sections.completions ?? [];
    const mdxCompleted = await safe(
      listMangaDex({
        status: ["completed"],
        order: { updatedAt: "desc" },
        hasAvailableChapters: true,
        limit: CAP * 2,
      }),
      [] as BackboneWork[],
    );
    const mdxItems = mdxCompleted.map(workToItem);

    const completed = {
      "7d": dedupCap(mdxItems.slice(0, CAP)),
      "30d": dedupCap(comickCompletions.length ? comickCompletions : mdxItems.slice(0, CAP)),
      "12m": dedupCap(mdxItems.slice(CAP, CAP * 2)),
    };

    let bestNew = dedupCap(sections.bestNew ?? []);
    if (bestNew.length === 0) {
      const since = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
      const mdxNew = await safe(
        listMangaDex({
          createdAtSince: since,
          order: { rating: "desc" },
          hasAvailableChapters: true,
          limit: CAP,
        }),
        [] as BackboneWork[],
      );
      bestNew = dedupCap(mdxNew.map(workToItem));
    }

    const data: HomeSections = { popular, completed, bestNew };
    if (hasAny(data)) {
      sectionsCache = { data, at: now };
      return data;
    }
    return sectionsCache?.data ?? data;
  } catch {
    return sectionsCache?.data ?? emptySections();
  }
}

export async function getBrowseGenres(): Promise<Genre[]> {
  const now = Date.now();
  if (genresCache && now - genresCache.at < TTL) return genresCache.data;
  const g = await safe(getComickGenres(), [] as Genre[]);
  if (g.length) {
    genresCache = { data: g, at: now };
    return g;
  }
  return genresCache?.data ?? FALLBACK_GENRES;
}
