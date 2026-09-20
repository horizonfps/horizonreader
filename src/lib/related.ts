// Works from the local catalog sharing genres with a given work. Server-side only.

import { prisma } from "@/lib/db";
import { isBlocked } from "@/lib/backbone/filter";
import type { Card } from "@/lib/cards";

const POOL = 120;
const CAP = 20;

function parseArr(json?: string | null): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

export async function getRelatedWorks(work: {
  id: number;
  type: string | null;
  genres: string | null;
}): Promise<Card[]> {
  const genres = parseArr(work.genres);
  if (!genres.length) return [];
  const anchors = genres.slice(0, 3);
  try {
    const rows = await prisma.work.findMany({
      where: {
        id: { not: work.id },
        coverUrl: { not: null },
        OR: anchors.map((g) => ({ genres: { contains: `"${g}"` } })),
      },
      orderBy: [{ follows: "desc" }, { rating: "desc" }],
      take: POOL,
    });
    const want = new Set(genres);
    const scored = rows
      .map((w) => {
        const g = parseArr(w.genres);
        if (isBlocked({ genres: g, contentRating: w.contentRating })) return null;
        let overlap = 0;
        for (const x of g) if (want.has(x)) overlap += 1;
        const score =
          overlap / Math.max(1, Math.max(g.length, genres.length)) +
          (w.type === work.type ? 0.25 : 0) +
          Math.min(0.3, Math.log10((w.follows ?? 0) + 1) / 20) +
          ((w.rating ?? 0) / 10) * 0.2;
        return { w, g, score, overlap };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.overlap >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, CAP);
    return scored.map(({ w, g }) => ({
      origin: w.origin === "comick" ? "comick" : "mangadex",
      externalId: w.externalId,
      slug: null,
      localSlug: w.slug,
      title: w.title,
      coverUrl: w.coverUrl,
      type: (w.type as Card["type"]) ?? null,
      status: (w.status as Card["status"]) ?? null,
      rating: w.rating,
      chapterCount: null,
      genres: g,
      contentRating: w.contentRating,
    }));
  } catch {
    return [];
  }
}
