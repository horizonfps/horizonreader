// Shared page-url resolution for the reader route and the next-chapter
// prefetch route, so both build Suwayomi/native urls the same way.

import { prisma } from "@/lib/db";
import { fetchChapterPages, proxied, pageUrl } from "@/lib/suwayomi";
import { getScraper } from "@/lib/scrapers";
import { NATIVE_OFFSET, isNativeChapterId, proxyScraperImage } from "@/lib/scrapers/native";

export function suwayomiPageUrls(d: {
  pages: string[];
  mangaId: number;
  sourceOrder: number;
  pageCount: number;
}): string[] {
  return d.pages && d.pages.length > 0
    ? d.pages.map((p) => proxied(p))
    : Array.from({ length: d.pageCount }, (_, i) => pageUrl(d.mangaId, d.sourceOrder, i));
}

// Resolves the first `limit` page urls of a chapter (native or Suwayomi).
// Never throws: a failure just means nothing gets prefetched.
export async function chapterPageUrls(chapterId: number, limit: number): Promise<string[]> {
  try {
    if (isNativeChapterId(chapterId)) {
      const row = await prisma.scrapedChapter.findUnique({
        where: { id: chapterId - NATIVE_OFFSET },
        include: { sourceLink: true },
      });
      if (!row) return [];
      const scraper = getScraper(row.sourceLink.sourceId);
      if (!scraper) return [];
      const pages = await scraper.pages(row.chapterKey);
      return pages.slice(0, limit).map(proxyScraperImage);
    }

    const data = await fetchChapterPages(chapterId);
    return suwayomiPageUrls(data).slice(0, limit);
  } catch {
    return [];
  }
}
