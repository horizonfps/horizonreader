// Background warm of the chapter list of every good source of a work, so
// switching source is a cache read instead of a cold fetch.

import { prisma } from "@/lib/db";
import { refreshChapters, type ChapterLink } from "@/lib/chapterCache";

const COOLDOWN_MS = 600_000;
const FRESH_MS = 6 * 3_600_000;
const WARM_CONCURRENCY = 2;
const DEFAULT_MAX = 8;

const warmedAt = new Map<number, number>();

async function isStored(link: { id: number; kind: string }): Promise<boolean> {
  // Scraper chapters live in their own table, so there is no cache row to age
  // out; warming them is a cheap DB read.
  if (link.kind === "scraper") return false;
  try {
    const row = await prisma.chapterListCache.findUnique({
      where: { sourceLinkId: link.id },
      select: { fetchedAt: true },
    });
    return !!row && Date.now() - row.fetchedAt.getTime() < FRESH_MS;
  } catch {
    return false;
  }
}

// Never throws and never has a screen waiting on it: callers may use `void`.
export async function warmWorkChapters(
  workId: number,
  opts?: { max?: number },
): Promise<number> {
  const max = opts?.max ?? DEFAULT_MAX;
  if (max <= 0) return 0;

  let links: (ChapterLink & { id: number; kind: string })[];
  try {
    links = (await prisma.sourceLink.findMany({
      where: { workId, chapterCount: { gt: 0 } },
      orderBy: [{ isPrimary: "desc" }, { healthScore: "desc" }],
    })) as (ChapterLink & { id: number; kind: string })[];
  } catch (e) {
    console.warn(`[warm] load links failed (work ${workId})`, e);
    return 0;
  }

  const now = Date.now();
  const candidates: typeof links = [];
  for (const link of links.slice(0, max)) {
    const last = warmedAt.get(link.id);
    if (last && now - last < COOLDOWN_MS) continue;
    if (await isStored(link)) continue;
    candidates.push(link);
  }
  if (!candidates.length) return 0;

  let next = 0;
  let warmed = 0;
  const workers = Array.from(
    { length: Math.min(WARM_CONCURRENCY, candidates.length) },
    async () => {
      while (next < candidates.length) {
        const link = candidates[next++];
        warmedAt.set(link.id, Date.now());
        await refreshChapters(link).catch(() => {});
        warmed += 1;
      }
    },
  );
  await Promise.all(workers).catch(() => {});
  console.info(`[warm] work ${workId}: ${warmed}/${links.length} source(s) warmed`);
  return warmed;
}
