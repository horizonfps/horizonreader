// Bridges native scraper sources into the SourceLink/reader layer, which keys on
// integer chapter ids. Persisted ScrapedChapter rows map to public ids offset by
// NATIVE_OFFSET so they never collide with Suwayomi's (small) chapter ids.

import { prisma } from "@/lib/db";
import { getScraper } from "@/lib/scrapers";

export const NATIVE_OFFSET = 2_000_000_000;

export function isNativeChapterId(id: number): boolean {
  return id >= NATIVE_OFFSET;
}

// FNV-1a 32-bit, kept positive. Stable synthetic Suwayomi-style manga id for a
// scraper link so the (sourceId, sourceMangaId) unique holds per manga.
export function keyToMangaId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

export function proxyScraperImage(url: string): string {
  return `/api/image?url=${encodeURIComponent(url)}`;
}

export type NativeChapterRow = {
  id: number; // public id (NATIVE_OFFSET + row id)
  name: string;
  chapterNumber: number;
  scanlator: string | null;
  uploadDate: string | null; // epoch ms as string, matching Suwayomi shape
};

// Scrape a native link's chapters and persist them, returning the public rows.
// Returns { count, latestMs } for health/link bookkeeping.
export async function syncNativeChapters(link: {
  id: number;
  sourceId: string;
  sourceMangaKey: string | null;
}): Promise<{ count: number; latestMs: number }> {
  const scraper = getScraper(link.sourceId);
  if (!scraper || !link.sourceMangaKey) return { count: 0, latestMs: 0 };

  const chapters = await scraper.chapters(link.sourceMangaKey);
  let latestMs = 0;
  for (const c of chapters) {
    if (c.date && c.date > latestMs) latestMs = c.date;
    await prisma.scrapedChapter.upsert({
      where: { sourceLinkId_chapterKey: { sourceLinkId: link.id, chapterKey: c.key } },
      create: {
        sourceLinkId: link.id,
        chapterKey: c.key,
        name: c.name,
        number: c.number,
        uploadDate: c.date ? new Date(c.date) : null,
      },
      update: { name: c.name, number: c.number, uploadDate: c.date ? new Date(c.date) : null },
    });
  }
  return { count: chapters.length, latestMs };
}

// Read persisted chapters for a native link in Suwayomi display order (desc).
export async function getNativeChapters(linkId: number): Promise<NativeChapterRow[]> {
  const rows = await prisma.scrapedChapter.findMany({
    where: { sourceLinkId: linkId },
    orderBy: { number: "desc" },
  });
  return rows.map((r) => ({
    id: NATIVE_OFFSET + r.id,
    name: r.name,
    chapterNumber: r.number,
    scanlator: null,
    uploadDate: r.uploadDate ? String(r.uploadDate.getTime()) : null,
  }));
}
