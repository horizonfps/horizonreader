// Comick client (api.comick.dev). Server-side only.

import type { BackboneWork, SectionItem, WorkStatus, WorkType } from "@/lib/backbone/types";

const BASE = "https://api.comick.dev";
const COVERS = "https://meo.comick.pictures";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) horizonreader";
const HEADERS: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };

// FlareSolverr proxy for Cloudflare-protected requests. Docker sets this to the
// internal service; dev falls back to the published localhost port.
const FLARE = process.env.FLARESOLVERR_URL || "http://localhost:8191";

// Windows accepted by /top?type=trending (7/30/90 come back regardless).
const EXTENDED_DAYS = new Set([180, 270, 360]);

const TOP_TTL = 60 * 60 * 1000;
let topCache: { data: unknown; at: number } | null = null;

export async function getComickTop(): Promise<any> {
  const now = Date.now();
  if (topCache && now - topCache.at < TOP_TTL) return topCache.data;
  try {
    const res = await fetch(`${BASE}/top?accept_mature_content=false`, {
      headers: HEADERS,
      cache: "no-store",
    });
    if (!res.ok) return topCache?.data ?? null;
    const data = await res.json();
    topCache = { data, at: now };
    return data;
  } catch {
    return topCache?.data ?? null;
  }
}

// country -> WorkType (jp/kr/cn like originLangToType's ja/ko/zh).
function comickType(country?: string | null): WorkType | null {
  const c = (country || "").toLowerCase();
  if (!c) return null;
  switch (c) {
    case "jp":
      return "manga";
    case "kr":
      return "manhwa";
    case "cn":
    case "hk":
      return "manhua";
    default:
      return "other";
  }
}

function comickStatus(status?: number | null): WorkStatus | null {
  switch (status) {
    case 1:
      return "ongoing";
    case 2:
      return "completed";
    case 3:
      return "cancelled";
    case 4:
      return "hiatus";
    default:
      return null;
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function coverUrl(item: any): string | null {
  const key = item?.md_covers?.[0]?.b2key;
  return key ? `${COVERS}/${key}` : null;
}

// Genre names carried by /top items (md_comic_md_genres[].md_genres.name/slug).
function comickGenres(item: any): string[] {
  const raw = Array.isArray(item?.md_comic_md_genres) ? item.md_comic_md_genres : [];
  const out: string[] = [];
  for (const g of raw) {
    const name = g?.md_genres?.name || g?.md_genres?.slug;
    if (typeof name === "string" && name) out.push(name);
  }
  return out;
}

function pickTitle(item: any, alt: string[]): string {
  if (item?.title) return item.title;
  const md = Array.isArray(item?.md_titles) ? item.md_titles : [];
  return md.find((t: any) => t?.is_default)?.title || alt[0] || "";
}

function toSectionItem(item: any): SectionItem {
  const alt = (Array.isArray(item?.md_titles) ? item.md_titles : [])
    .map((t: any) => t?.title)
    .filter(Boolean);
  return {
    origin: "comick",
    externalId: String(item?.hid ?? item?.id ?? item?.slug ?? ""),
    slug: item?.slug ?? null,
    title: pickTitle(item, alt),
    coverUrl: coverUrl(item),
    type: comickType(item?.country),
    status: comickStatus(item?.status),
    rating: numOrNull(item?.rating),
    chapterCount: numOrNull(item?.last_chapter),
    genres: comickGenres(item),
    contentRating: item?.content_rating ?? null,
  };
}

function toItems(arr: unknown): SectionItem[] {
  return Array.isArray(arr) ? arr.map(toSectionItem) : [];
}

// topFollow* are keyed by day window; pick the first available in preferred order.
function pickBucket(obj: any, prefer: string[]): unknown[] {
  if (!obj || typeof obj !== "object") return [];
  for (const k of prefer) if (Array.isArray(obj[k])) return obj[k];
  const first = Object.values(obj).find(Array.isArray);
  return (first as unknown[]) ?? [];
}

export async function comickSections(): Promise<{
  trending: Record<string, SectionItem[]>;
  popularAllTime: SectionItem[];
  bestNew: SectionItem[];
  completions: SectionItem[];
}> {
  const top = await getComickTop();
  const trending: Record<string, SectionItem[]> = {};
  const buckets = top?.trending;
  if (buckets && typeof buckets === "object") {
    for (const k of Object.keys(buckets)) trending[k] = toItems(buckets[k]);
  }
  return {
    trending,
    popularAllTime: toItems(pickBucket(top?.topFollowComics, ["90", "30", "7"])),
    bestNew: toItems(pickBucket(top?.topFollowNewComics, ["7", "30", "90"])),
    completions: toItems(top?.completions),
  };
}

export async function getComickTrending(opts: {
  day?: number;
  comic_types?: "manga" | "manhwa" | "manhua";
}): Promise<SectionItem[]> {
  const day = opts?.day ?? 7;
  // 7/30/90 are always present in the buckets object; only extended windows must be requested.
  const reqDay = EXTENDED_DAYS.has(day) ? day : 180;
  const qs = new URLSearchParams({
    type: "trending",
    day: String(reqDay),
    accept_mature_content: "false",
  });
  if (opts?.comic_types) qs.set("comic_types", opts.comic_types);
  try {
    const res = await fetch(`${BASE}/top?${qs.toString()}`, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const bucket = data?.[String(day)] ?? data?.trending?.[String(day)] ?? data?.["7"] ?? [];
    return toItems(bucket);
  } catch {
    return [];
  }
}

export async function getComickGenres(): Promise<{ name: string; slug: string; group: string }[]> {
  try {
    const res = await fetch(`${BASE}/genre`, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((g: any) => ({ name: g?.name, slug: g?.slug, group: g?.group ?? "" }))
      .filter((g) => g.name && g.slug);
  } catch {
    return [];
  }
}

function toBackboneWork(item: any): BackboneWork {
  const alt = (Array.isArray(item?.md_titles) ? item.md_titles : [])
    .map((t: any) => t?.title)
    .filter(Boolean);
  const title = pickTitle(item, alt);
  return {
    origin: "comick",
    externalId: String(item?.hid ?? item?.slug ?? item?.id ?? ""),
    title,
    altTitles: [...new Set([title, ...alt].filter(Boolean))],
    description: item?.desc ?? null,
    coverUrl: coverUrl(item),
    author: null,
    artist: null,
    type: comickType(item?.country),
    status: comickStatus(item?.status),
    contentRating: item?.content_rating ?? null,
    year: numOrNull(item?.year) ?? numOrNull(item?.mu_comics?.year),
    rating: numOrNull(item?.rating),
    follows: numOrNull(item?.user_follow_count ?? item?.follow_count),
    genres: comickGenres(item),
    muId: null,
  };
}

// FlareSolverr wraps the JSON body in HTML; pull the outermost array/object back out.
function extractJson(html: string): string | null {
  const a = html.indexOf("[");
  const az = html.lastIndexOf("]");
  if (a !== -1 && az > a) return html.slice(a, az + 1);
  const o = html.indexOf("{");
  const oz = html.lastIndexOf("}");
  if (o !== -1 && oz > o) return html.slice(o, oz + 1);
  return null;
}

async function searchViaFlareSolverr(url: string): Promise<any> {
  try {
    const res = await fetch(`${FLARE}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60000 }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json();
    const html = body?.solution?.response;
    if (typeof html !== "string") return null;
    const json = extractJson(html);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

// Minimal Comick detail lookup (genres + content_rating) used to vet a Comick
// ref before resolving it, since refs carry no genre/rating in the URL.
export async function getComickContentInfo(
  hid: string,
): Promise<{ genres: string[]; contentRating: string | null } | null> {
  const id = (hid || "").trim();
  if (!id) return null;
  const url = `${BASE}/comic/${encodeURIComponent(id)}`;
  let data: any = null;
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (res.ok) data = await res.json();
    else if (res.status === 403) data = await searchViaFlareSolverr(url);
  } catch {
    data = await searchViaFlareSolverr(url);
  }
  const comic = data?.comic;
  if (!comic) return null;
  return { genres: comickGenres(comic), contentRating: comic?.content_rating ?? null };
}

export async function searchComick(q: string): Promise<BackboneWork[]> {
  const query = (q || "").trim();
  if (!query) return [];
  const url = `${BASE}/v1.0/search?${new URLSearchParams({ q: query, limit: "8" }).toString()}`;
  let data: unknown = null;
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (res.ok) data = await res.json();
    else if (res.status === 403) data = await searchViaFlareSolverr(url);
  } catch {
    data = await searchViaFlareSolverr(url);
  }
  if (!Array.isArray(data)) return [];
  return data.map(toBackboneWork);
}
