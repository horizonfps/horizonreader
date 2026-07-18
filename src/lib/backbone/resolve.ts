// Turns backbone works into local Work rows and links them to Suwayomi scan sources.
// All Suwayomi/DB calls are guarded: log + degrade, never throw to the caller.

import { prisma } from "@/lib/db";
import type { BackboneWork } from "@/lib/backbone/types";
import { norm, matchKeys, slugify, tokenSetRatio } from "@/lib/backbone/normalize";
import { isBlocked } from "@/lib/backbone/filter";
import { scoreSourceLink } from "@/lib/backbone/health";
import {
  searchMangaDex,
  getMangaDexManga,
  getMangaDexStatistics,
} from "@/lib/backbone/mangadex";
import { getComickContentInfo } from "@/lib/backbone/comick";
import {
  listSources,
  browseSource,
  getManga,
  getChapters,
  refreshManga,
  type SuwayomiSource,
  type SuwayomiManga,
} from "@/lib/suwayomi";
import { SCRAPERS } from "@/lib/scrapers";
import { keyToMangaId, syncNativeChapters } from "@/lib/scrapers/native";

const DAY_MS = 86_400_000;
const FORCE_COOLDOWN_MS = 120_000;
const REF_FRESH_MS = 6 * 3_600_000;
const SOURCE_TIMEOUT = 8_000;
const SCRAPER_TIMEOUT = 90_000;
const MATCH_THRESHOLD = 0.88;

// Scan-source languages to search. Suwayomi reports Brazilian Portuguese as
// "pt-BR" (some sources as "pt"); normalize both.
const PREFERRED_LANGS = new Set(["en", "pt-br", "pt"]);
function normLang(lang?: string | null): string {
  return (lang || "").toLowerCase();
}

// ---- helpers ----

function parseArr(json?: string | null): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

function union(...arrs: string[][]): string[] {
  return [...new Set(arrs.flat().filter(Boolean))];
}

// FNV-1a 32-bit, base36. Stable short salt for slug uniqueness.
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Suwayomi uploadDate is epoch millis as a string; fall back to Date.parse.
function parseUploadDate(s?: string | null): number {
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function descriptiveData(bw: BackboneWork) {
  return {
    description: bw.description ?? undefined,
    coverUrl: bw.coverUrl ?? undefined,
    author: bw.author ?? undefined,
    artist: bw.artist ?? undefined,
    type: bw.type ?? undefined,
    status: bw.status ?? undefined,
    contentRating: bw.contentRating ?? undefined,
    year: bw.year ?? undefined,
    rating: bw.rating ?? undefined,
    follows: bw.follows ?? undefined,
    genres: bw.genres ? JSON.stringify(bw.genres) : undefined,
  };
}

async function reserveSlug(title: string, salt: string): Promise<string> {
  const base = slugify(title, salt);
  let candidate = base;
  let n = 1;
  while (n < 50) {
    const clash = await prisma.work.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash) return candidate;
    candidate = `${base}-${n++}`;
  }
  return `${base}-${shortHash(`${title}:${Date.now()}`)}`;
}

// ---- upsertWork ----

export async function upsertWork(bw: BackboneWork): Promise<{ id: number; created: boolean }> {
  const titles = [bw.title, ...(bw.altTitles ?? [])].filter(Boolean);
  const keys = matchKeys(titles);
  const normalizedKey = norm(bw.title);

  // 1) existing by unique (origin, externalId) -> refresh in place.
  const existing = await prisma.work.findUnique({
    where: { origin_externalId: { origin: bw.origin, externalId: bw.externalId } },
    select: { id: true },
  });
  if (existing) {
    await prisma.work.update({
      where: { id: existing.id },
      data: {
        title: bw.title,
        normalizedKey,
        altTitles: JSON.stringify(titles),
        matchKeys: JSON.stringify(keys),
        ...descriptiveData(bw),
      },
    });
    return { id: existing.id, created: false };
  }

  // 2) exact normalized-key pre-filter (indexed) -> merge onto the hit.
  const preFilter = await prisma.work.findMany({
    where: { normalizedKey: { in: keys } },
    select: { id: true, altTitles: true, matchKeys: true },
    take: 1,
  });
  if (preFilter.length) {
    const hit = preFilter[0];
    await prisma.work.update({
      where: { id: hit.id },
      data: {
        altTitles: JSON.stringify(union(parseArr(hit.altTitles), titles)),
        matchKeys: JSON.stringify(union(parseArr(hit.matchKeys), keys)),
      },
    });
    return { id: hit.id, created: false };
  }

  // 3) new Work with a unique slug (retry on collision).
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await reserveSlug(bw.title, shortHash(bw.externalId));
    try {
      const work = await prisma.work.create({
        data: {
          slug,
          origin: bw.origin,
          externalId: bw.externalId,
          title: bw.title,
          normalizedKey,
          altTitles: JSON.stringify(titles),
          matchKeys: JSON.stringify(keys),
          ...descriptiveData(bw),
        },
        select: { id: true },
      });
      return { id: work.id, created: true };
    } catch (e) {
      // Unique collision on slug or origin+externalId. Re-check the external id.
      const dup = await prisma.work
        .findUnique({
          where: { origin_externalId: { origin: bw.origin, externalId: bw.externalId } },
          select: { id: true },
        })
        .catch(() => null);
      if (dup) return { id: dup.id, created: false };
      if (attempt === 4) throw e;
    }
  }
  throw new Error("upsertWork: exhausted slug retries");
}

// ---- resolveSourcesForWork ----

async function syncMatch(source: SuwayomiSource, workId: number, result: SuwayomiManga) {
  try {
    await refreshManga(result.id).catch(() => {});
    const [manga, chapters] = await Promise.all([
      getManga(result.id).catch(() => null),
      getChapters(result.id).catch(() => [] as Awaited<ReturnType<typeof getChapters>>),
    ]);
    const chapterCount = manga?.chapters?.totalCount ?? chapters.length ?? 0;
    // A match without readable chapters is a dead source; keep it out so it
    // neither shows in the UI nor marks the work as freshly synced.
    if (chapterCount === 0) {
      await prisma.sourceLink
        .deleteMany({ where: { sourceId: source.id, sourceMangaId: result.id } })
        .catch(() => {});
      return;
    }
    let latestMs = 0;
    for (const c of chapters) latestMs = Math.max(latestMs, parseUploadDate(c.uploadDate));
    const latestAt = latestMs > 0 ? new Date(latestMs) : null;
    const sourceName = source.displayName || source.name || null;
    const healthScore = scoreSourceLink({
      sourceId: source.id,
      sourceName,
      chapterCount,
      latestAt,
    });
    const url = manga?.realUrl ?? null;
    const lang = source.lang || null;
    const now = new Date();
    await prisma.sourceLink.upsert({
      where: { sourceId_sourceMangaId: { sourceId: source.id, sourceMangaId: result.id } },
      create: {
        workId,
        sourceId: source.id,
        sourceName,
        sourceMangaId: result.id,
        lang,
        url,
        chapterCount,
        latestAt,
        healthScore,
        lastSyncedAt: now,
      },
      update: { workId, sourceName, lang, url, chapterCount, latestAt, healthScore, lastSyncedAt: now },
    });
  } catch (e) {
    console.warn(`[resolve] syncMatch failed (source ${source.id}, manga ${result.id})`, e);
  }
}

async function searchAndMatch(
  source: SuwayomiSource,
  workId: number,
  query: string,
  titles: string[],
): Promise<boolean> {
  const { mangas } = await browseSource(source.id, "SEARCH", 1, query);
  let matched = false;
  for (const result of (mangas ?? []).slice(0, 5)) {
    let best = 0;
    for (const t of titles) best = Math.max(best, tokenSetRatio(result.title, t));
    if (best >= MATCH_THRESHOLD) {
      await syncMatch(source, workId, result);
      matched = true;
    }
  }
  return matched;
}

async function processSource(
  source: SuwayomiSource,
  workId: number,
  queries: string[],
  titles: string[],
) {
  try {
    // Try each query in order (English first, then localized alt titles) until a
    // match lands. pt-BR scan sites index by the Portuguese title, so an English
    // query alone misses them.
    for (const query of queries) {
      if (await searchAndMatch(source, workId, query, titles)) return;
    }
  } catch (e) {
    console.warn(`[resolve] processSource failed (source ${source.id})`, e);
  }
}

async function processScraper(
  scraper: (typeof SCRAPERS)[number],
  workId: number,
  queries: string[],
  titles: string[],
) {
  try {
    let match: { key: string; title: string } | null = null;
    for (const query of queries) {
      const results = await scraper.search(query).catch(() => []);
      for (const r of results.slice(0, 5)) {
        let best = 0;
        for (const t of titles) best = Math.max(best, tokenSetRatio(r.title, t));
        if (best >= MATCH_THRESHOLD) {
          match = r;
          break;
        }
      }
      if (match) break;
    }
    if (!match) return;

    const sourceMangaId = keyToMangaId(match.key);
    const link = await prisma.sourceLink.upsert({
      where: { sourceId_sourceMangaId: { sourceId: scraper.id, sourceMangaId } },
      create: {
        workId,
        sourceId: scraper.id,
        sourceName: scraper.name,
        sourceMangaId,
        kind: "scraper",
        sourceMangaKey: match.key,
        lang: scraper.lang,
        url: match.key,
      },
      update: { workId, sourceName: scraper.name, sourceMangaKey: match.key, url: match.key },
      select: { id: true },
    });

    const { count, latestMs } = await syncNativeChapters({
      id: link.id,
      sourceId: scraper.id,
      sourceMangaKey: match.key,
    });
    // A scraper that matched but yields no readable chapters (e.g. blocked by a
    // challenge) is a dead source; drop the link so it isn't shown.
    if (count === 0) {
      await prisma.sourceLink.delete({ where: { id: link.id } }).catch(() => {});
      return;
    }
    const latestAt = latestMs > 0 ? new Date(latestMs) : null;
    const healthScore = scoreSourceLink({
      sourceId: scraper.id,
      sourceName: scraper.name,
      chapterCount: count,
      latestAt,
    });
    await prisma.sourceLink.update({
      where: { id: link.id },
      data: { chapterCount: count, latestAt, healthScore, lastSyncedAt: new Date() },
    });
  } catch (e) {
    console.warn(`[resolve] processScraper failed (source ${scraper.id})`, e);
  }
}

export async function resolveSourcesForWork(
  workId: number,
  opts?: { force?: boolean },
): Promise<void> {
  const force = opts?.force ?? false;

  let work: {
    title: string;
    altTitles: string | null;
    links: { lastSyncedAt: Date | null; chapterCount: number }[];
  } | null;
  try {
    work = await prisma.work.findUnique({
      where: { id: workId },
      select: {
        title: true,
        altTitles: true,
        links: { select: { lastSyncedAt: true, chapterCount: true } },
      },
    });
  } catch (e) {
    console.warn(`[resolve] load work ${workId} failed`, e);
    return;
  }
  if (!work) return;

  // Force skips the daily freshness check but keeps a short cooldown so the
  // refresh button cannot hammer every source. Only links that actually carry
  // chapters count as fresh; zero-chapter links must not park a work for a day.
  const cutoff = Date.now() - (force ? FORCE_COOLDOWN_MS : DAY_MS);
  const fresh = work.links.some(
    (l) => l.chapterCount > 0 && l.lastSyncedAt && l.lastSyncedAt.getTime() >= cutoff,
  );
  if (fresh) return;

  const titles = [work.title, ...parseArr(work.altTitles)].filter(Boolean);
  // work.title is the English title when MangaDex has one (see mapManga). Distinct
  // alt titles feed a fallback search so pt-BR/native-indexed sources still match.
  const queries = [...new Set([work.title, ...parseArr(work.altTitles)])]
    .filter(Boolean)
    .slice(0, 3);

  // A dead Suwayomi must not block native scrapers; they run independently.
  let sources: SuwayomiSource[] = [];
  try {
    sources = await listSources();
  } catch (e) {
    console.warn("[resolve] listSources failed", e);
  }
  // Only English and Brazilian-Portuguese scan sources are relevant. Searching all
  // ~250 (every language) overloads Suwayomi and causes timeout-induced misses.
  const wanted = sources.filter((s) => PREFERRED_LANGS.has(normLang(s.lang)));
  const targets = wanted.length ? wanted : sources;

  const nativeScrapers = SCRAPERS.filter((s) => PREFERRED_LANGS.has(normLang(s.lang)));

  await Promise.allSettled([
    ...targets.map((s) =>
      withTimeout(processSource(s, workId, queries, titles), SOURCE_TIMEOUT).catch(() => {}),
    ),
    // Native scrapers may route through FlareSolverr, so give them more headroom.
    ...nativeScrapers.map((s) =>
      withTimeout(processScraper(s, workId, queries, titles), SCRAPER_TIMEOUT).catch(() => {}),
    ),
  ]);

  // Promote the healthiest link to primary.
  try {
    const links = await prisma.sourceLink.findMany({
      where: { workId },
      orderBy: { healthScore: "desc" },
      select: { id: true },
    });
    if (links.length) {
      const topId = links[0].id;
      await prisma.sourceLink.updateMany({
        where: { workId, id: { not: topId } },
        data: { isPrimary: false },
      });
      await prisma.sourceLink.update({ where: { id: topId }, data: { isPrimary: true } });
    }
  } catch (e) {
    console.warn(`[resolve] promote primary failed (work ${workId})`, e);
  }
}

// ---- reads ----

export async function getWorkWithLinks(
  workId: number,
): Promise<{ work: any; links: any[] } | null> {
  try {
    const work = await prisma.work.findUnique({
      where: { id: workId },
      include: {
        links: { orderBy: [{ isPrimary: "desc" }, { healthScore: "desc" }] },
      },
    });
    if (!work) return null;
    const { links, ...rest } = work;
    return { work: rest, links };
  } catch (e) {
    console.warn(`[resolve] getWorkWithLinks failed (work ${workId})`, e);
    return null;
  }
}

export async function getPrimaryLink(workId: number): Promise<any | null> {
  try {
    const primary = await prisma.sourceLink.findFirst({ where: { workId, isPrimary: true } });
    if (primary) return primary;
    return await prisma.sourceLink.findFirst({
      where: { workId },
      orderBy: { healthScore: "desc" },
    });
  } catch (e) {
    console.warn(`[resolve] getPrimaryLink failed (work ${workId})`, e);
    return null;
  }
}

// ---- ref -> canonical Work (the bridge from a home/browse/search item) ----

export type WorkRef = {
  origin: "mangadex" | "comick";
  externalId: string;
  title?: string | null;
  coverUrl?: string | null;
  type?: string | null;
  status?: string | null;
};

function coerceType(t?: string | null): BackboneWork["type"] {
  return t === "manga" || t === "manhwa" || t === "manhua" || t === "other" ? t : null;
}
function coerceStatus(s?: string | null): BackboneWork["status"] {
  return s === "ongoing" || s === "completed" || s === "hiatus" || s === "cancelled" || s === "unknown"
    ? s
    : null;
}

// Resolve a backbone list item to a local canonical Work. MangaDex items resolve
// by id; Comick items canonicalize onto MangaDex by title, else persist as-is.
export async function resolveWorkFromRef(
  ref: WorkRef,
): Promise<{ workId: number; slug: string } | null> {
  try {
    // A recently refreshed Work resolves straight from the DB, skipping the
    // backbone fetch + upsert on every card click.
    const cached = await prisma.work
      .findUnique({
        where: { origin_externalId: { origin: ref.origin, externalId: ref.externalId } },
        select: { id: true, slug: true, updatedAt: true },
      })
      .catch(() => null);
    if (cached && Date.now() - cached.updatedAt.getTime() < REF_FRESH_MS) {
      return { workId: cached.id, slug: cached.slug };
    }

    let bw: BackboneWork | null = null;

    if (ref.origin === "mangadex") {
      bw = await getMangaDexManga(ref.externalId);
    } else {
      const title = (ref.title || "").trim();
      if (title) {
        const cands = await searchMangaDex(title, 6);
        let best: BackboneWork | null = null;
        let bestScore = 0;
        for (const c of cands) {
          const s = Math.max(
            tokenSetRatio(title, c.title),
            ...c.altTitles.map((t) => tokenSetRatio(title, t)),
          );
          if (s > bestScore) {
            bestScore = s;
            best = c;
          }
        }
        if (best && bestScore >= 0.85) bw = best;
      }
      if (!bw) {
        bw = {
          origin: "comick",
          externalId: ref.externalId,
          title: (ref.title || "Untitled").trim() || "Untitled",
          altTitles: [],
          coverUrl: ref.coverUrl ?? null,
          type: coerceType(ref.type),
          status: coerceStatus(ref.status),
        };
      }
    }

    if (!bw) return null;

    // A Comick-only ref (no MangaDex canonicalization) carries no genre/rating in
    // the URL, so fetch Comick detail by hid before the policy guard below.
    if (bw.origin === "comick") {
      const info = await getComickContentInfo(ref.externalId);
      if (info) {
        bw.genres = info.genres;
        bw.contentRating = info.contentRating;
      }
    }

    // Content policy: never resolve/open NSFW or BL-GL works, even via a direct link.
    if (isBlocked({ genres: bw.genres, contentRating: bw.contentRating })) return null;

    if (bw.origin === "mangadex") {
      try {
        const stats = await getMangaDexStatistics([bw.externalId]);
        const st = stats[bw.externalId];
        if (st) {
          bw.rating = st.rating ?? bw.rating ?? null;
          bw.follows = st.follows ?? bw.follows ?? null;
        }
      } catch {
        /* rating is optional */
      }
    }

    const { id } = await upsertWork(bw);
    const row = await prisma.work.findUnique({ where: { id }, select: { slug: true } });
    if (!row) return null;
    return { workId: id, slug: row.slug };
  } catch (e) {
    console.warn("[resolve] resolveWorkFromRef failed", e);
    return null;
  }
}
