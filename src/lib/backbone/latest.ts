// Latest chapter uploads across MangaDex, grouped by work. Server-side only.

import { mdxJson } from "@/lib/backbone/mangadex";
import { isBlocked } from "@/lib/backbone/filter";
import { attachLocalSlugs } from "@/lib/backbone/localslugs";
import { originLangToType, type SectionItem } from "@/lib/backbone/types";

const COVERS = "https://uploads.mangadex.org/covers";
const FEED_LIMIT = 100;
const MAX_WORKS = 40;
export const LATEST_PAGE_MAX = 10;
const MAX_CHAPTERS_PER_WORK = 3;
export const LATEST_LANGS = ["pt-br", "en"];
export type LatestLang = "all" | "pt-br" | "en";

export type LatestChapter = {
  id: string;
  chapter: string | null;
  volume: string | null;
  title: string | null;
  lang: string;
  group: string | null;
  readableAt: string;
};

export type LatestUpdate = {
  work: SectionItem;
  chapters: LatestChapter[];
};

type MdxChapter = {
  id: string;
  attributes?: {
    volume?: string | null;
    chapter?: string | null;
    title?: string | null;
    translatedLanguage?: string;
    readableAt?: string;
    publishAt?: string;
  };
  relationships?: { id: string; type: string; attributes?: RelAttrs }[];
};

type RelAttrs = {
  name?: string;
  title?: Record<string, string>;
  altTitles?: Record<string, string>[];
  originalLanguage?: string | null;
  status?: string | null;
  contentRating?: string | null;
  tags?: { attributes?: { group?: string; name?: Record<string, string> } }[];
};

type MdxMangaLite = {
  id: string;
  relationships?: { type?: string; attributes?: { fileName?: string } }[];
};

const CJK = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;

function pickTitle(attrs?: RelAttrs): string {
  const title: Record<string, string> = attrs?.title ?? {};
  if (title.en) return title.en;
  for (const [k, v] of Object.entries(title)) if (k.endsWith("-ro") && v && !CJK.test(v)) return v;
  for (const alt of attrs?.altTitles ?? []) if (alt?.en) return alt.en;
  for (const v of Object.values(title)) if (v && !CJK.test(v)) return v;
  return Object.values(title)[0] ?? "";
}

function statusOf(s?: string | null): SectionItem["status"] {
  const v = (s || "").toLowerCase();
  if (v === "ongoing" || v === "completed" || v === "hiatus" || v === "cancelled") return v;
  return null;
}

const caches = new Map<string, { data: LatestUpdate[]; at: number }>();
const TTL = 5 * 60_000;
const inFlight = new Map<string, Promise<LatestUpdate[]>>();

async function build(page: number, lang: LatestLang): Promise<LatestUpdate[]> {
  const qs = new URLSearchParams();
  qs.set("limit", String(FEED_LIMIT));
  if (page > 0) qs.set("offset", String(page * FEED_LIMIT));
  qs.set("order[readableAt]", "desc");
  qs.append("includes[]", "manga");
  qs.append("includes[]", "scanlation_group");
  for (const l of lang === "all" ? LATEST_LANGS : [lang]) qs.append("translatedLanguage[]", l);
  for (const r of ["safe", "suggestive"]) qs.append("contentRating[]", r);
  const d = await mdxJson<{ data?: MdxChapter[] }>(`/chapter?${qs.toString()}`);
  const rows = d?.data ?? [];
  if (!rows.length) return [];

  const byWork = new Map<string, LatestUpdate>();
  for (const ch of rows) {
    const manga = ch.relationships?.find((r) => r.type === "manga");
    if (!manga?.id) continue;
    const a = manga.attributes;
    const genres = (a?.tags ?? [])
      .filter((t) => t.attributes?.group === "genre" || t.attributes?.group === "theme")
      .map((t) => t.attributes?.name?.en)
      .filter((x): x is string => !!x);
    if (isBlocked({ genres, contentRating: a?.contentRating })) continue;

    let entry = byWork.get(manga.id);
    if (!entry) {
      if (byWork.size >= MAX_WORKS) continue;
      entry = {
        work: {
          origin: "mangadex",
          externalId: manga.id,
          slug: null,
          title: pickTitle(a),
          coverUrl: null,
          type: originLangToType(a?.originalLanguage),
          status: statusOf(a?.status),
          rating: null,
          chapterCount: null,
          genres,
          contentRating: a?.contentRating ?? null,
        },
        chapters: [],
      };
      byWork.set(manga.id, entry);
    }
    if (entry.chapters.length >= MAX_CHAPTERS_PER_WORK) continue;
    const group = ch.relationships?.find((r) => r.type === "scanlation_group");
    entry.chapters.push({
      id: ch.id,
      chapter: ch.attributes?.chapter ?? null,
      volume: ch.attributes?.volume ?? null,
      title: ch.attributes?.title ?? null,
      lang: ch.attributes?.translatedLanguage ?? "en",
      group: group?.attributes?.name ?? null,
      readableAt: ch.attributes?.readableAt ?? ch.attributes?.publishAt ?? "",
    });
  }

  const ids = [...byWork.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const cq = new URLSearchParams();
    for (const id of batch) cq.append("ids[]", id);
    cq.append("includes[]", "cover_art");
    cq.set("limit", String(batch.length));
    const covers = await mdxJson<{ data?: MdxMangaLite[] }>(`/manga?${cq.toString()}`);
    for (const m of covers?.data ?? []) {
      const file = m.relationships?.find((r) => r.type === "cover_art")?.attributes?.fileName;
      const entry = byWork.get(m.id);
      if (entry && file) entry.work.coverUrl = `${COVERS}/${m.id}/${file}.256.jpg`;
    }
  }

  const list = [...byWork.values()];
  await attachLocalSlugs([list.map((u) => u.work)]);
  return list;
}

export async function getLatestUpdates(page = 0, lang: LatestLang = "all"): Promise<LatestUpdate[]> {
  const key = `${lang}:${page}`;
  const now = Date.now();
  const cache = caches.get(key);
  if (cache && now - cache.at < TTL) return cache.data;
  const running = inFlight.get(key);
  if (running) return cache?.data ?? running;
  const p = build(page, lang)
    .then((data) => {
      if (data.length) caches.set(key, { data, at: Date.now() });
      return caches.get(key)?.data ?? data;
    })
    .catch(() => caches.get(key)?.data ?? [])
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return cache?.data ?? p;
}
