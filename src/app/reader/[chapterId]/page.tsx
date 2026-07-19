import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fetchChapterPages, getChapters, proxied, pageUrl } from "@/lib/suwayomi";
import { getScraper } from "@/lib/scrapers";
import { NATIVE_OFFSET, isNativeChapterId, proxyScraperImage } from "@/lib/scrapers/native";
import { dedupeByNumber, scanlatorKey } from "@/lib/chapters";
import Reader from "@/components/Reader";

export const dynamic = "force-dynamic";

type ReaderData = {
  urls: string[];
  mangaId: number;
  workId: number | null;
  workSlug: string | null;
  chapterNumber?: number;
  title: string;
  prevId: number | null;
  nextId: number | null;
};

// Native scraper chapter: pages scraped live, prev/next from persisted rows.
async function loadNative(chapterId: number): Promise<ReaderData | null> {
  const rowId = chapterId - NATIVE_OFFSET;
  const row = await prisma.scrapedChapter
    .findUnique({
      where: { id: rowId },
      include: { sourceLink: { include: { work: true } } },
    })
    .catch(() => null);
  if (!row) return null;

  const scraper = getScraper(row.sourceLink.sourceId);
  if (!scraper) return null;

  const pages = await scraper.pages(row.chapterKey).catch(() => []);
  if (!pages.length) return null;

  const siblingRows = await prisma.scrapedChapter.findMany({
    where: { sourceLinkId: row.sourceLinkId },
    select: { id: true, number: true, uploadDate: true },
  });
  const siblings = dedupeByNumber(
    siblingRows.map((s) => ({
      id: s.id,
      name: "",
      chapterNumber: s.number,
      uploadDate: s.uploadDate ? String(s.uploadDate.getTime()) : null,
    })),
    rowId,
  ).sort((a, b) => a.chapterNumber - b.chapterNumber);
  const idx = siblings.findIndex((s) => s.id === rowId);
  const prevId = idx > 0 ? NATIVE_OFFSET + siblings[idx - 1].id : null;
  const nextId = idx >= 0 && idx < siblings.length - 1 ? NATIVE_OFFSET + siblings[idx + 1].id : null;

  return {
    urls: pages.map(proxyScraperImage),
    mangaId: row.sourceLink.sourceMangaId,
    workId: row.sourceLink.workId,
    workSlug: row.sourceLink.work?.slug ?? null,
    chapterNumber: row.number,
    title: row.name,
    prevId,
    nextId,
  };
}

// Suwayomi chapter: pages fetched from the engine, prev/next from its chapter list.
async function loadSuwayomi(chapterId: number): Promise<ReaderData | null> {
  const data = await fetchChapterPages(chapterId).catch(() => null);
  if (!data) return null;

  const { pages, mangaId, sourceOrder, pageCount } = data;
  const urls =
    pages && pages.length > 0
      ? pages.map((p) => proxied(p))
      : Array.from({ length: pageCount }, (_, i) => pageUrl(mangaId, sourceOrder, i));

  // Navigate within the current chapter's scanlator only, so next/prev advances
  // by number instead of jumping to another scan's upload of the same chapter.
  const chapters = await getChapters(mangaId).catch(() => []);
  const current = chapters.find((c) => c.id === chapterId);
  const pool = current
    ? chapters.filter((c) => scanlatorKey(c.scanlator) === scanlatorKey(current.scanlator))
    : chapters;
  const ordered = dedupeByNumber(pool, chapterId).sort((a, b) => a.chapterNumber - b.chapterNumber);
  const idx = ordered.findIndex((c) => c.id === chapterId);

  const link = await prisma.sourceLink.findFirst({
    where: { sourceMangaId: mangaId },
    include: { work: true },
  });

  return {
    urls,
    mangaId,
    workId: link?.workId ?? null,
    workSlug: link?.work?.slug ?? null,
    chapterNumber: idx >= 0 ? ordered[idx].chapterNumber : undefined,
    title: idx >= 0 ? ordered[idx].name : "",
    prevId: idx > 0 ? ordered[idx - 1].id : null,
    nextId: idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].id : null,
  };
}

export default async function ReaderPage({ params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId: cidStr } = await params;
  const chapterId = Number(cidStr);
  const session = await getSession();
  if (!Number.isInteger(chapterId) || !session) notFound();

  const data = isNativeChapterId(chapterId)
    ? await loadNative(chapterId)
    : await loadSuwayomi(chapterId);
  if (!data) notFound();

  const prog = await prisma.progress.findUnique({
    where: { userId_chapterId: { userId: session.uid, chapterId } },
  });
  const initialPage = Math.min(
    Math.max(prog?.lastPageRead ?? 0, 0),
    Math.max(data.urls.length - 1, 0),
  );

  return (
    <Reader
      key={chapterId}
      chapterId={chapterId}
      mangaId={data.mangaId}
      workId={data.workId}
      workSlug={data.workSlug}
      chapterNumber={data.chapterNumber}
      pageUrls={data.urls}
      initialPage={initialPage}
      title={data.title}
      prevChapterId={data.prevId}
      nextChapterId={data.nextId}
    />
  );
}
