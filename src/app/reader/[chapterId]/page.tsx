import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fetchChapterPages, getChapters } from "@/lib/suwayomi";
import { getScraper } from "@/lib/scrapers";
import { NATIVE_OFFSET, isNativeChapterId, proxyScraperImage } from "@/lib/scrapers/native";
import { suwayomiPageUrls } from "@/lib/readerPages";
import { dedupeByNumber, scanlatorKey } from "@/lib/chapters";
import Reader from "@/components/Reader";

export const dynamic = "force-dynamic";

type ReaderData = {
  urls: string[];
  mangaId: number;
  workId: number | null;
  workSlug: string | null;
  workTitle: string | null;
  chapterNumber?: number;
  title: string;
  prevId: number | null;
  nextId: number | null;
};

type StoredChapter = { urls: string[]; mangaId: number };

const SUWAYOMI_PAGE_PATH = /^\/api\/v1\/manga\/(\d+)\/chapter\//;

// The image service worker is cache-first, so a page seen before the download
// would be replayed from its pre-download response. A marker keeps the
// downloaded read on its own url; the proxy ignores the extra param.
function downloadUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}dl=1`;
}

// A download queued without the manga id still carries it inside every stored
// page path, which keeps the shortcut usable without asking the engine.
function mangaIdFromPages(urls: string[]): number {
  for (const url of urls) {
    let path: string | null;
    try {
      path = new URL(url, "http://internal").searchParams.get("path");
    } catch {
      continue;
    }
    const match = path ? SUWAYOMI_PAGE_PATH.exec(path) : null;
    if (match) return Number(match[1]);
  }
  return 0;
}

// A finished download already holds every page url, so the source is never
// touched again for this chapter.
async function storedChapter(chapterId: number): Promise<StoredChapter | null> {
  const row = await prisma.chapterDownload
    .findUnique({ where: { chapterId } })
    .catch(() => null);
  if (!row || row.status !== "DONE") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.pages);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const urls = parsed.filter((u): u is string => typeof u === "string" && u.length > 0);
  if (!urls.length) return null;
  const mangaId = row.mangaId > 0 ? row.mangaId : mangaIdFromPages(urls);
  return { urls: urls.map(downloadUrl), mangaId };
}

// Native scraper chapter: pages scraped live, prev/next from persisted rows.
async function loadNative(chapterId: number, stored?: string[]): Promise<ReaderData | null> {
  const rowId = chapterId - NATIVE_OFFSET;
  const row = await prisma.scrapedChapter
    .findUnique({
      where: { id: rowId },
      include: { sourceLink: { include: { work: true } } },
    })
    .catch(() => null);
  if (!row) return null;

  let pages: string[];
  if (stored?.length) {
    pages = stored;
  } else {
    const scraper = getScraper(row.sourceLink.sourceId);
    if (!scraper) return null;
    const scraped = await scraper.pages(row.chapterKey).catch(() => []);
    if (!scraped.length) return null;
    pages = scraped.map(proxyScraperImage);
  }

  const siblingRows = await prisma.scrapedChapter.findMany({
    where: { sourceLinkId: row.sourceLinkId },
    select: { id: true, number: true, scanlator: true, uploadDate: true },
  });
  // Stay inside the open chapter's scan group, so next/prev never jumps to a
  // different group's upload of the same number.
  const pool = siblingRows.filter((s) => scanlatorKey(s.scanlator) === scanlatorKey(row.scanlator));
  const siblings = dedupeByNumber(
    (pool.length ? pool : siblingRows).map((s) => ({
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
    urls: pages,
    mangaId: row.sourceLink.sourceMangaId,
    workId: row.sourceLink.workId,
    workSlug: row.sourceLink.work?.slug ?? null,
    workTitle: row.sourceLink.work?.title ?? null,
    chapterNumber: row.number,
    title: row.name,
    prevId,
    nextId,
  };
}

// Suwayomi chapter: pages fetched from the engine, prev/next from its chapter list.
async function loadSuwayomi(
  chapterId: number,
  stored?: StoredChapter,
): Promise<ReaderData | null> {
  let mangaId: number;
  let urls: string[];

  if (stored) {
    mangaId = stored.mangaId;
    urls = stored.urls;
  } else {
    const data = await fetchChapterPages(chapterId).catch(() => null);
    if (!data) return null;
    mangaId = data.mangaId;
    urls = suwayomiPageUrls(data);
  }

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
    workTitle: link?.work?.title ?? null,
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

  const native = isNativeChapterId(chapterId);
  const download = await storedChapter(chapterId);
  // A Suwayomi row without mangaId cannot resolve title and prev/next.
  const stored = download && (native || download.mangaId > 0) ? download : null;

  const data = native
    ? await loadNative(chapterId, stored?.urls)
    : await loadSuwayomi(chapterId, stored ?? undefined);
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
      workTitle={data.workTitle}
      chapterNumber={data.chapterNumber}
      pageUrls={data.urls}
      initialPage={initialPage}
      title={data.title}
      prevChapterId={data.prevId}
      nextChapterId={data.nextId}
      downloaded={!!stored}
    />
  );
}
