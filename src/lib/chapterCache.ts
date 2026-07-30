// Two-tier chapter list cache: an in-memory tier in front of a per-source-link
// DB row, so repeat work-page views skip the Suwayomi round-trip and a fresh
// app start still paints instantly from the last known list.

import { prisma } from "@/lib/db";
import type { RawChapter } from "@/lib/chapters";
import { getNativeChapters } from "@/lib/scrapers/native";
import { getMangaEnsured, getChapters } from "@/lib/suwayomi";

const MEM_TTL = 30 * 60 * 1000;
const DB_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { data: unknown; at: number }>();
const inFlight = new Map<string, Promise<void>>();

export type ChapterLink = {
  id: number;
  kind?: string | null;
  sourceMangaId: number;
  chapterCount?: number;
};

export function chapterCacheKey(link: ChapterLink): string {
  return link.kind === "scraper" ? `n:${link.id}` : `s:${link.sourceMangaId}`;
}

// The real fetch from source, split out so background revalidation loops
// (other tickets in this round) can call it without going through a page.
export async function loadChaptersForLink(link: ChapterLink): Promise<RawChapter[]> {
  if (link.kind === "scraper") {
    return getNativeChapters(link.id).catch(() => []);
  }
  // A link that already carries chapters was initialized by the sync.
  if (!link.chapterCount) await getMangaEnsured(link.sourceMangaId).catch(() => null);
  return getChapters(link.sourceMangaId).catch(() => []);
}

function setMem(key: string, data: unknown, at: number): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, { data, at });
}

export async function getCachedChapters<T>(
  link: ChapterLink,
): Promise<{ data: T; stale: boolean } | null> {
  const key = chapterCacheKey(link);
  const mem = cache.get(key);
  if (mem) return { data: mem.data as T, stale: Date.now() - mem.at > MEM_TTL };

  if (link.kind === "scraper") return null;
  try {
    const row = await prisma.chapterListCache.findUnique({ where: { sourceLinkId: link.id } });
    if (!row) return null;
    const at = row.fetchedAt.getTime();
    if (Date.now() - at > DB_TTL) return null;
    const data = JSON.parse(row.payload) as T;
    setMem(key, data, at);
    return { data, stale: Date.now() - at > MEM_TTL };
  } catch {
    return null;
  }
}

export async function setCachedChapters(link: ChapterLink, data: unknown[]): Promise<void> {
  const key = chapterCacheKey(link);
  setMem(key, data, Date.now());

  if (link.kind === "scraper") return;
  try {
    const payload = JSON.stringify(data);
    await prisma.chapterListCache.upsert({
      where: { sourceLinkId: link.id },
      create: { sourceLinkId: link.id, payload, fetchedAt: new Date() },
      update: { payload, fetchedAt: new Date() },
    });
  } catch {
    // best-effort: memory tier already has it
  }
}

export async function bustChapters(links: ChapterLink[]): Promise<void> {
  for (const link of links) cache.delete(chapterCacheKey(link));
  if (!links.length) return;
  try {
    await prisma.chapterListCache.deleteMany({
      where: { sourceLinkId: { in: links.map((l) => l.id) } },
    });
  } catch {
    // best-effort
  }
}

// Loads fresh chapters and updates both cache tiers. Concurrent callers for
// the same link share one in-flight fetch instead of each paying for one.
export async function refreshChapters(link: ChapterLink): Promise<void> {
  const key = chapterCacheKey(link);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const data = await loadChaptersForLink(link);
      if (data.length) await setCachedChapters(link, data);
    } catch {
      // never throw: cache refresh is best-effort
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
}

// Fire-and-forget revalidation for callers that already have a stale hit to serve.
export function revalidateChapters(link: ChapterLink): void {
  void refreshChapters(link);
}
