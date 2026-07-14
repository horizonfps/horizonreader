// MangaDex client (api.mangadex.org, no auth). Server-side only.

import type { BackboneWork, WorkStatus } from "@/lib/backbone/types";
import { originLangToType } from "@/lib/backbone/types";

const BASE = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) horizonreader";

// MangaDex rejects requests without a browser-like header set (400 "Unsupported
// Browser"), so send these alongside the required User-Agent.
const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

const DEFAULT_RATINGS = ["safe", "suggestive", "erotica"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Politeness throttle: serialize calls and space them (~4.5 req/s).
const MIN_GAP = 220;
let gate: Promise<void> = Promise.resolve();
let last = 0;
function schedule(): Promise<void> {
  const next = gate.then(async () => {
    const wait = last + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  });
  gate = next;
  return next;
}

async function getJson<T = unknown>(path: string): Promise<T | null> {
  try {
    await schedule();
    const res = await fetch(`${BASE}${path}`, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type MdxManga = {
  id: string;
  attributes?: {
    title?: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    originalLanguage?: string | null;
    status?: string | null;
    year?: number | null;
    contentRating?: string | null;
    tags?: { attributes?: { group?: string; name?: Record<string, string> } }[];
    links?: Record<string, string> | null;
  };
  relationships?: { type?: string; attributes?: { fileName?: string } }[];
};

function mdxStatus(s?: string | null): WorkStatus {
  switch ((s || "").toLowerCase()) {
    case "ongoing":
      return "ongoing";
    case "completed":
      return "completed";
    case "hiatus":
      return "hiatus";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function firstValue(o?: Record<string, string>): string {
  if (!o) return "";
  for (const v of Object.values(o)) if (v) return v;
  return "";
}

function collectTitles(m: MdxManga): string[] {
  const out = new Set<string>();
  const t = m.attributes?.title;
  if (t) for (const v of Object.values(t)) if (v) out.add(v);
  for (const alt of m.attributes?.altTitles ?? [])
    for (const v of Object.values(alt ?? {})) if (v) out.add(v);
  return [...out];
}

function coverUrl(m: MdxManga): string | null {
  const rel = (m.relationships ?? []).find((r) => r.type === "cover_art");
  const file = rel?.attributes?.fileName;
  return file ? `${COVERS}/${m.id}/${file}.256.jpg` : null;
}

// Prefer the English title (title.en, else an en alt-title) so display and scan
// searches use English, not the romaji/CJK canonical.
function englishTitle(a: MdxManga["attributes"]): string | null {
  if (!a) return null;
  if (a.title?.en) return a.title.en;
  for (const alt of a.altTitles ?? []) if (alt?.en) return alt.en;
  return null;
}

function mapManga(m: MdxManga): BackboneWork {
  const a = m.attributes ?? {};
  const genres = (a.tags ?? [])
    .filter((t) => t.attributes?.group === "genre")
    .map((t) => t.attributes?.name?.en)
    .filter((x): x is string => !!x);
  return {
    origin: "mangadex",
    externalId: m.id,
    title: englishTitle(a) ?? firstValue(a.title),
    altTitles: collectTitles(m),
    description: a.description?.en ?? null,
    coverUrl: coverUrl(m),
    type: originLangToType(a.originalLanguage),
    status: mdxStatus(a.status),
    contentRating: a.contentRating ?? null,
    year: typeof a.year === "number" ? a.year : null,
    genres,
    muId: a.links?.mu ?? null,
  };
}

function appendAll(qs: URLSearchParams, key: string, vals?: (string | number)[]) {
  for (const v of vals ?? []) qs.append(key, String(v));
}

export async function searchMangaDex(title: string, limit = 8): Promise<BackboneWork[]> {
  const qs = new URLSearchParams();
  qs.set("title", title);
  qs.set("limit", String(limit));
  qs.append("includes[]", "cover_art");
  appendAll(qs, "contentRating[]", DEFAULT_RATINGS);
  qs.set("order[relevance]", "desc");
  const d = await getJson<{ data?: MdxManga[] }>(`/manga?${qs.toString()}`);
  if (!d || !Array.isArray(d.data)) return [];
  return d.data.map(mapManga);
}

export async function getMangaDexManga(id: string): Promise<BackboneWork | null> {
  const qs = new URLSearchParams();
  qs.append("includes[]", "cover_art");
  const d = await getJson<{ data?: MdxManga }>(`/manga/${encodeURIComponent(id)}?${qs.toString()}`);
  if (!d || !d.data) return null;
  return mapManga(d.data);
}

export async function getMangaDexStatistics(
  ids: string[],
): Promise<Record<string, { rating: number | null; follows: number | null }>> {
  const out: Record<string, { rating: number | null; follows: number | null }> = {};
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const qs = new URLSearchParams();
    appendAll(qs, "manga[]", batch);
    const d = await getJson<{
      statistics?: Record<
        string,
        { rating?: { bayesian?: number; average?: number }; follows?: number }
      >;
    }>(`/statistics/manga?${qs.toString()}`);
    const stats = d?.statistics ?? {};
    for (const id of batch) {
      const st = stats[id];
      const r = (st?.rating?.bayesian || st?.rating?.average || 0) || null;
      out[id] = {
        rating: typeof r === "number" ? r : null,
        follows: typeof st?.follows === "number" ? st.follows : null,
      };
    }
  }
  return out;
}

export async function getMangaDexChapterCount(id: string): Promise<number> {
  const qs = new URLSearchParams();
  qs.append("translatedLanguage[]", "en");
  const d = await getJson<{
    volumes?: Record<string, { chapters?: Record<string, { chapter?: string }> }>;
  }>(`/manga/${encodeURIComponent(id)}/aggregate?${qs.toString()}`);
  const volumes = d?.volumes;
  if (!volumes || typeof volumes !== "object") return 0;
  const seen = new Set<string>();
  for (const vol of Object.values(volumes)) {
    const chapters = vol?.chapters;
    if (!chapters || typeof chapters !== "object") continue;
    for (const [key, ch] of Object.entries(chapters)) seen.add(ch?.chapter || key);
  }
  return seen.size;
}

export async function getMangaDexTags(): Promise<{ id: string; name: string; group: string }[]> {
  const d = await getJson<{
    data?: { id: string; attributes?: { group?: string; name?: Record<string, string> } }[];
  }>("/manga/tag");
  if (!d || !Array.isArray(d.data)) return [];
  return d.data
    .map((t) => ({
      id: t.id,
      name: t.attributes?.name?.en ?? firstValue(t.attributes?.name),
      group: t.attributes?.group ?? "",
    }))
    .filter((t) => t.id && t.name);
}

export async function listMangaDex(opts: {
  order?: Record<string, "asc" | "desc">;
  status?: string[];
  createdAtSince?: string;
  updatedAtSince?: string;
  originalLanguage?: string[];
  includedTags?: string[];
  hasAvailableChapters?: boolean;
  limit?: number;
  offset?: number;
  contentRating?: string[];
}): Promise<BackboneWork[]> {
  const qs = new URLSearchParams();
  qs.append("includes[]", "cover_art");
  for (const [k, v] of Object.entries(opts.order ?? {})) qs.set(`order[${k}]`, v);
  appendAll(qs, "status[]", opts.status);
  appendAll(qs, "originalLanguage[]", opts.originalLanguage);
  appendAll(qs, "includedTags[]", opts.includedTags);
  appendAll(qs, "contentRating[]", opts.contentRating ?? DEFAULT_RATINGS);
  if (opts.createdAtSince) qs.set("createdAtSince", opts.createdAtSince);
  if (opts.updatedAtSince) qs.set("updatedAtSince", opts.updatedAtSince);
  if (typeof opts.hasAvailableChapters === "boolean")
    qs.set("hasAvailableChapters", opts.hasAvailableChapters ? "true" : "false");
  if (typeof opts.limit === "number") qs.set("limit", String(opts.limit));
  if (typeof opts.offset === "number") qs.set("offset", String(opts.offset));
  const d = await getJson<{ data?: MdxManga[] }>(`/manga?${qs.toString()}`);
  if (!d || !Array.isArray(d.data)) return [];
  return d.data.map(mapManga);
}
