// "Horizon Recomenda" assembly: admin-curated picks only, newest first.
// Server-side only.

import { prisma } from "@/lib/db";
import type { SectionItem, WorkStatus, WorkType } from "@/lib/backbone/types";

const CAP = 30;

function coerceType(t?: string | null): WorkType | null {
  return t === "manga" || t === "manhwa" || t === "manhua" || t === "other" ? t : null;
}
function coerceStatus(s?: string | null): WorkStatus | null {
  return s === "ongoing" || s === "completed" || s === "hiatus" || s === "cancelled" || s === "unknown"
    ? s
    : null;
}

export async function getHorizonPicks(): Promise<SectionItem[]> {
  try {
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
  } catch {
    return [];
  }
}
