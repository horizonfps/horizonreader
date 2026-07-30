// Background loop that pre-downloads the first pages of each favorite's next
// unread chapter into the disk image cache, so opening it later is instant.

import { prisma } from "@/lib/db";
import { getPrimaryLink } from "@/lib/backbone/resolve";
import { getCachedChapters, loadChaptersForLink, setCachedChapters } from "@/lib/chapterCache";
import { dedupeByNumber, type RawChapter } from "@/lib/chapters";
import { isNativeChapterId, NATIVE_OFFSET, proxyScraperImage } from "@/lib/scrapers/native";
import { fetchChapterPages, proxied, pageUrl } from "@/lib/suwayomi";
import { getScraper, isAllowedImageHost } from "@/lib/scrapers";
import { getDiskImage, setDiskImage } from "@/lib/diskCache";

const raw = (process.env.PAGE_WARM || "").trim().toLowerCase();
const ENABLED = raw ? raw === "true" || raw === "1" : process.env.NODE_ENV === "production";

function numEnv(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const INTERVAL_MIN = numEnv("PAGE_WARM_INTERVAL_MIN", 60);
const MAX_WORKS = numEnv("PAGE_WARM_MAX_WORKS", 20);
const PAGES = numEnv("PAGE_WARM_PAGES", 5);
const IDLE_MIN = numEnv("PAGE_WARM_IDLE_MIN", 5);

const FIRST_RUN_DELAY_MS = 5 * 60_000;
const CYCLE_DEADLINE_MS = 10 * 60_000;

const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const SUWAYOMI_IMAGE_PATH = /^\/api\/v1\/manga\/\d+\/(thumbnail|chapter\/\d+\/page\/\d+)(\?.*)?$/;

type ChapterLink = { id: number; kind?: string | null; sourceMangaId: number; chapterCount?: number };

async function someoneIsReading(): Promise<boolean> {
  const since = new Date(Date.now() - IDLE_MIN * 60_000);
  const row = await prisma.progress
    .findFirst({ where: { updatedAt: { gt: since } }, select: { id: true } })
    .catch(() => null);
  return !!row;
}

// First `limit` page URLs for a chapter, proxied the same way the reader gets
// them. Never throws: a source hiccup just means nothing gets warmed this pass.
async function chapterPageUrls(chapterId: number, limit: number): Promise<string[]> {
  try {
    if (isNativeChapterId(chapterId)) {
      const row = await prisma.scrapedChapter
        .findUnique({ where: { id: chapterId - NATIVE_OFFSET }, include: { sourceLink: true } })
        .catch(() => null);
      if (!row) return [];
      const scraper = getScraper(row.sourceLink.sourceId);
      if (!scraper) return [];
      const pages = await scraper.pages(row.chapterKey).catch(() => []);
      return pages.slice(0, limit).map(proxyScraperImage);
    }
    const data = await fetchChapterPages(chapterId).catch(() => null);
    if (!data) return [];
    const { pages, mangaId, sourceOrder, pageCount } = data;
    const urls =
      pages && pages.length > 0
        ? pages.map((p) => proxied(p))
        : Array.from({ length: pageCount }, (_, i) => pageUrl(mangaId, sourceOrder, i));
    return urls.slice(0, limit);
  } catch {
    return [];
  }
}

// Resolves a proxied /api/image URL back to its origin target and caches it on
// disk under that same key, so a later real request is already a cache hit.
async function warmProxiedPage(proxiedUrl: string): Promise<boolean> {
  try {
    const u = new URL(proxiedUrl, "http://internal");
    const urlParam = u.searchParams.get("url");
    const pathParam = u.searchParams.get("path") || "";

    let target: string;
    let referer: string | undefined;

    if (urlParam) {
      let ext: URL;
      try {
        ext = new URL(urlParam);
      } catch {
        return false;
      }
      if (ext.protocol !== "https:" || !isAllowedImageHost(ext.host)) return false;
      target = ext.toString();
      referer = `${ext.protocol}//${ext.host}/`;
    } else if (SUWAYOMI_IMAGE_PATH.test(pathParam)) {
      target = BASE + pathParam;
    } else {
      return false;
    }

    const isPage = !!urlParam || pathParam.includes("/chapter/");
    if (!isPage) return false;

    if (await getDiskImage(target, "page")) return false;

    const res = await fetch(target, {
      cache: "no-store",
      redirect: "manual",
      headers: referer ? { "User-Agent": UA, Referer: referer } : undefined,
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res || res.status !== 200) return false;

    const body = new Uint8Array(await res.arrayBuffer());
    await setDiskImage(
      target,
      body,
      res.headers.get("content-type") || "application/octet-stream",
      "page",
    );
    return true;
  } catch {
    return false;
  }
}

async function cycle(): Promise<void> {
  const started = Date.now();
  try {
    if (await someoneIsReading()) {
      console.log("[pagewarm] skipped: someone is reading");
      return;
    }

    const favorites = await prisma.favorite
      .findMany({
        select: { userId: true, workId: true },
        orderBy: { updatedAt: "desc" },
        take: MAX_WORKS,
      })
      .catch(() => []);

    let worksVisited = 0;
    let pagesDownloaded = 0;

    for (const fav of favorites) {
      if (Date.now() - started > CYCLE_DEADLINE_MS) break;
      if (await someoneIsReading()) break;

      worksVisited += 1;
      try {
        const link = await getPrimaryLink(fav.workId);
        if (!link) continue;

        const hit = await getCachedChapters<RawChapter[]>(link);
        let chapters = hit?.data ?? [];
        if (!chapters.length) {
          chapters = await loadChaptersForLink(link);
          if (chapters.length) await setCachedChapters(link, chapters);
        }
        if (!chapters.length) continue;

        const progressRows = await prisma.progress.findMany({
          where: { userId: fav.userId, mangaId: link.sourceMangaId },
          select: { chapterId: true, read: true },
        });
        const readIds = new Set(progressRows.filter((p) => p.read).map((p) => p.chapterId));

        const ordered = dedupeByNumber(chapters).sort((a, b) => a.chapterNumber - b.chapterNumber);
        const next = ordered.find((c) => !readIds.has(c.id));
        if (!next) continue;

        const urls = await chapterPageUrls(next.id, PAGES);
        for (const url of urls) {
          if (await warmProxiedPage(url)) pagesDownloaded += 1;
        }
      } catch {
        continue;
      }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[pagewarm] warmed ${pagesDownloaded} page(s) across ${worksVisited} work(s) in ${seconds}s`);
  } catch (e) {
    console.log("[pagewarm] cycle failed", e);
  }
}

function scheduleNext(delayMs: number): void {
  const t = setTimeout(() => {
    cycle().finally(() => scheduleNext(INTERVAL_MIN * 60_000));
  }, delayMs);
  (t as unknown as { unref?: () => void }).unref?.();
}

const globalForPageWarm = globalThis as unknown as { pageWarmStarted?: boolean };

export function startPageWarm(): void {
  if (!ENABLED) return;
  if (globalForPageWarm.pageWarmStarted) return;
  globalForPageWarm.pageWarmStarted = true;
  scheduleNext(FIRST_RUN_DELAY_MS);
}
