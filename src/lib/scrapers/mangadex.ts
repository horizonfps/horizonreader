// MangaDex as a reading source, not just the metadata backbone. It carries a
// huge slice of the catalogue that no scan site indexes, needs no challenge
// solver, and a work that came from MangaDex links by uuid instead of by title.

import type { Scraper, ScraperChapter, ScraperManga } from "./types";
import { mdxJson } from "../backbone/mangadex";
import { BLOCKED_MDX_TAGS } from "../backbone/filter";

const TITLE_PREFIX = "https://mangadex.org/title/";
const CHAPTER_PREFIX = "https://mangadex.org/chapter/";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const RATINGS = ["safe", "suggestive", "erotica"];
const FEED_PAGE = 500;
const MAX_CHAPTERS = 2_000;
// at-home answers are cheap to reuse and rate-limited harder than the rest of
// the API (40/min), so a chapter's server assignment is held between opens.
const AT_HOME_TTL_MS = 10 * 60_000;

export const MANGADEX_IMAGE_HOSTS = ["uploads.mangadex.org", ".mangadex.network"];

export function mangadexTitleKey(id: string): string {
  return `${TITLE_PREFIX}${id}`;
}

function idFromKey(key: string): string | null {
  return key.match(UUID)?.[0] ?? null;
}

type MdxChapter = {
  id: string;
  attributes?: {
    volume?: string | null;
    chapter?: string | null;
    title?: string | null;
    translatedLanguage?: string | null;
    externalUrl?: string | null;
    isUnavailable?: boolean;
    pages?: number;
    publishAt?: string | null;
    readableAt?: string | null;
  };
  relationships?: { type?: string; attributes?: { name?: string } }[];
};

function scanlatorOf(c: MdxChapter): string | null {
  const rel = (c.relationships ?? []).find((r) => r.type === "scanlation_group");
  return rel?.attributes?.name?.trim() || null;
}

function chapterName(a: MdxChapter["attributes"]): string {
  const num = a?.chapter?.trim();
  const title = a?.title?.trim();
  const head = num ? `Cap. ${num}` : title ? "" : "Oneshot";
  if (head && title) return `${head} - ${title}`;
  return head || title || "Capítulo";
}

function parseWhen(a: MdxChapter["attributes"]): number | null {
  const raw = a?.readableAt || a?.publishAt;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

const atHomeCache = new Map<string, { urls: string[]; at: number }>();

type MadaraLikeConfig = { id: string; name: string; lang: string; apiLangs: string[] };

export function createMangaDex(cfg: MadaraLikeConfig): Scraper {
  const langParams = cfg.apiLangs.map((l) => `translatedLanguage[]=${encodeURIComponent(l)}`).join("&");

  async function search(query: string): Promise<ScraperManga[]> {
    const qs = new URLSearchParams();
    qs.set("title", query);
    qs.set("limit", "10");
    qs.set("order[relevance]", "desc");
    qs.set("hasAvailableChapters", "true");
    for (const r of RATINGS) qs.append("contentRating[]", r);
    for (const t of BLOCKED_MDX_TAGS) qs.append("excludedTags[]", t);
    for (const l of cfg.apiLangs) qs.append("availableTranslatedLanguage[]", l);
    qs.append("includes[]", "cover_art");

    const d = await mdxJson<{
      data?: { id: string; attributes?: { title?: Record<string, string>; altTitles?: Record<string, string>[] } }[];
    }>(`/manga?${qs.toString()}`);
    if (!d?.data) return [];
    return d.data.map((m) => {
      const t = m.attributes?.title ?? {};
      const title = t.en || Object.values(t).find(Boolean) || "Untitled";
      return { key: mangadexTitleKey(m.id), title };
    });
  }

  async function chapters(mangaKey: string): Promise<ScraperChapter[]> {
    const id = idFromKey(mangaKey);
    if (!id) return [];

    const out: ScraperChapter[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset < MAX_CHAPTERS; offset += FEED_PAGE) {
      const qs = new URLSearchParams();
      qs.set("limit", String(FEED_PAGE));
      qs.set("offset", String(offset));
      qs.set("order[volume]", "desc");
      qs.set("order[chapter]", "desc");
      qs.set("includeExternalUrl", "0");
      for (const r of RATINGS) qs.append("contentRating[]", r);
      qs.append("includes[]", "scanlation_group");

      const d = await mdxJson<{ data?: MdxChapter[]; total?: number }>(
        `/manga/${id}/feed?${qs.toString()}&${langParams}`,
        12_000,
      );
      const batch = d?.data ?? [];
      for (const c of batch) {
        const a = c.attributes ?? {};
        // External hosts (Manga Plus, Azuki…) and pulled chapters have no
        // readable pages, so linking them would only produce a dead entry.
        if (a.externalUrl || a.isUnavailable || !(a.pages ?? 0)) continue;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const num = Number.parseFloat((a.chapter ?? "").replace(",", "."));
        out.push({
          key: `${CHAPTER_PREFIX}${c.id}`,
          name: chapterName(a),
          number: Number.isFinite(num) ? num : 0,
          date: parseWhen(a),
          scanlator: scanlatorOf(c),
        });
      }
      const total = d?.total ?? 0;
      if (batch.length < FEED_PAGE || offset + FEED_PAGE >= total) break;
    }
    return out;
  }

  async function pages(chapterKey: string): Promise<string[]> {
    const id = idFromKey(chapterKey);
    if (!id) return [];

    const hot = atHomeCache.get(id);
    if (hot && Date.now() - hot.at < AT_HOME_TTL_MS) return hot.urls;

    const d = await mdxJson<{
      baseUrl?: string;
      chapter?: { hash?: string; data?: string[]; dataSaver?: string[] };
    }>(`/at-home/server/${id}`, 15_000);
    const base = d?.baseUrl;
    const hash = d?.chapter?.hash;
    const files = d?.chapter?.data?.length ? d.chapter.data : d?.chapter?.dataSaver;
    const quality = d?.chapter?.data?.length ? "data" : "data-saver";
    if (!base || !hash || !files?.length) return [];

    const urls = files.map((f) => `${base}/${quality}/${hash}/${f}`);
    atHomeCache.set(id, { urls, at: Date.now() });
    return urls;
  }

  // A work that already came from MangaDex needs no title guessing: its uuid is
  // the source key, which is why these links never miss.
  function directKey(origin: string, externalId: string): string | null {
    return origin === "mangadex" && UUID.test(externalId) ? mangadexTitleKey(externalId) : null;
  }

  return {
    id: cfg.id,
    name: cfg.name,
    lang: cfg.lang,
    base: "https://mangadex.org",
    imageHosts: MANGADEX_IMAGE_HOSTS,
    search,
    chapters,
    pages,
    directKey,
  };
}
