// Turns backbone works into local Work rows and links them to Suwayomi scan sources.
// All Suwayomi/DB calls are guarded: log + degrade, never throw to the caller.

import { prisma } from "@/lib/db";
import type { BackboneWork } from "@/lib/backbone/types";
import {
  norm,
  matchKeys,
  slugify,
  matchScore,
  isMatch,
  strictSimilarity,
} from "@/lib/backbone/normalize";
import { isBlocked } from "@/lib/backbone/filter";
import { scoreSourceLink } from "@/lib/backbone/health";
import {
  isMuted,
  partitionByHealth,
  recordFail,
  recordHit,
  recordOk,
  recordTry,
} from "@/lib/backbone/sourceStats";
import { acquireEngineSlot } from "@/lib/backbone/engineGate";
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

const CJK = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;

const DAY_MS = 86_400_000;
const FORCE_COOLDOWN_MS = 120_000;
const REF_FRESH_MS = 6 * 3_600_000;
const SOURCE_TIMEOUT = 6_000;
const SCRAPER_TIMEOUT = 45_000;
const FAST_SCRAPER_TIMEOUT = 12_000;
// Hard ceiling on the whole Suwayomi sweep. Without it the pass lasts as long
// as the slowest extension, which is where the multi-minute waits came from.
const SWEEP_DEADLINE_MS = 20_000;
// The pass that runs after the page is served has no reader waiting on it, so
// it can afford to reach every remaining source.
const BACKGROUND_SWEEP_MS = 180_000;
// Per-work fan-out. The real ceiling is the process-wide engine gate, so this
// only needs to keep the gate fed; a wider pool would just claim sources it
// then drops at the deadline without ever searching them.
const SEARCH_CONCURRENCY = 12;
// Floor for accepting a canonicalization onto another backbone entry. Source
// matching uses the length-aware rule in normalize instead.
const MATCH_THRESHOLD = 0.8;
// Merging two backbone works into one is worse than duplicating, so hold it to a
// near-identical primary title.
const MERGE_THRESHOLD = 0.85;

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Bounded-concurrency worker pool that stops handing out work past a deadline
// or once `stop` says the caller has what it needs. Returns what it never got
// to, so the caller can finish the sweep off the request path instead of
// silently dropping those sources.
async function runPool<T>(
  items: T[],
  limit: number,
  deadline: number,
  fn: (item: T) => Promise<void>,
  stop?: () => boolean,
): Promise<T[]> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && Date.now() < deadline && !stop?.()) {
      const item = items[next++];
      await fn(item).catch(() => {});
    }
  });
  await Promise.all(workers);
  return items.slice(next);
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

  // 2) exact normalized-key pre-filter (indexed), then confirm the primary titles
  // are near-identical before merging. The pre-filter can hit on a shared generic
  // alt title, which must not glue two different works together.
  const preFilter = await prisma.work.findMany({
    where: { normalizedKey: { in: keys } },
    select: { id: true, title: true, altTitles: true, matchKeys: true },
    take: 5,
  });
  const hit = preFilter.find((h) => strictSimilarity(bw.title, h.title) >= MERGE_THRESHOLD);
  if (hit) {
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

// Links landed so far in one resolve. The foreground sweep stops handing out
// sources once it fills; the rest still get searched, just off the request path.
type Coverage = { hits: number };

const ENOUGH_LINKS = 3;

async function syncMatch(
  source: SuwayomiSource,
  workId: number,
  result: SuwayomiManga,
  coverage?: Coverage,
) {
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
    recordHit(source.id);
    if (coverage) coverage.hits += 1;
  } catch (e) {
    console.warn(`[resolve] syncMatch failed (source ${source.id}, manga ${result.id})`, e);
  }
}

// One source carries one edition of a work, so only the single best candidate
// may be linked. Syncing every result over the threshold was what put the same
// site on the page four or five times.
function pickBest<T extends { title: string }>(results: T[], titles: string[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const result of results.slice(0, 8)) {
    const score = matchScore(result.title, titles);
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }
  return best && isMatch(bestScore, best.title, titles) ? best : null;
}

function bestCandidate(mangas: SuwayomiManga[], titles: string[]): SuwayomiManga | null {
  return pickBest(mangas, titles);
}

function bestScraperCandidate(
  results: { key: string; title: string }[],
  titles: string[],
): { key: string; title: string } | null {
  return pickBest(results, titles);
}

async function searchAndMatch(
  source: SuwayomiSource,
  workId: number,
  query: string,
  titles: string[],
  budgetMs: number,
  coverage?: Coverage,
): Promise<boolean> {
  const { mangas } = await browseSource(source.id, "SEARCH", 1, query, budgetMs);
  const match = bestCandidate(mangas ?? [], titles);
  if (!match) return false;
  await syncMatch(source, workId, match, coverage);
  return true;
}

async function processSource(
  source: SuwayomiSource,
  workId: number,
  queries: string[],
  titles: string[],
  deadline: number,
  coverage?: Coverage,
) {
  // Try each query in order (English first, then localized alt titles) until a
  // match lands. pt-BR scan sites index by the Portuguese title, so an English
  // query alone misses them. Each query gets its own budget instead of sharing
  // one, and latency/failures feed the health memory.
  for (const query of queries) {
    // Time spent queueing for an engine slot is our own backlog, so the budget
    // and the health verdict both start once the slot is ours.
    const slot = await acquireEngineSlot(deadline);
    if (!slot) return;
    const started = Date.now();
    const budget = Math.min(SOURCE_TIMEOUT, deadline - started);
    // Too little left to judge the source fairly; leave it for the next pass.
    if (budget < 1_500) {
      slot.release();
      return;
    }
    recordTry(source.id);
    try {
      const hit = await withTimeout(
        searchAndMatch(source, workId, query, titles, budget, coverage),
        budget,
      );
      recordOk(source.id, Date.now() - started);
      if (hit) return;
    } catch (e) {
      // A source cut short by the sweep deadline is not unhealthy; one that
      // burned its own budget or errored outright is.
      const timedOut = e instanceof Error && e.message === "timeout";
      if (!timedOut || Date.now() - started >= SOURCE_TIMEOUT - 50) recordFail(source.id);
      return;
    } finally {
      slot.release();
    }
  }
}

async function processScraper(
  scraper: (typeof SCRAPERS)[number],
  workId: number,
  queries: string[],
  titles: string[],
  ref: { origin: string; externalId: string },
  coverage?: Coverage,
) {
  try {
    // A source that can be addressed by the backbone id skips title matching
    // entirely, which is the only way to never lose a work to a name mismatch.
    let match: { key: string; title: string } | null = null;
    const direct = scraper.directKey?.(ref.origin, ref.externalId) ?? null;
    if (direct) {
      match = { key: direct, title: titles[0] ?? "" };
    } else {
      for (const query of queries) {
        const results = await scraper.search(query).catch(() => []);
        const best = bestScraperCandidate(results, titles);
        if (best) {
          match = best;
          break;
        }
      }
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
    recordHit(scraper.id);
    if (coverage) coverage.hits += 1;
  } catch (e) {
    console.warn(`[resolve] processScraper failed (source ${scraper.id})`, e);
  }
}

// Coalesces concurrent resolves per work so a click reuses a warm already in
// flight instead of starting a duplicate full source sweep.
const inFlightResolves = new Map<number, Promise<void>>();

export function resolveSourcesForWork(
  workId: number,
  opts?: { force?: boolean; deep?: boolean },
): Promise<void> {
  const existing = inFlightResolves.get(workId);
  if (existing && !opts?.force) return existing;
  const p = doResolveSourcesForWork(workId, opts).finally(() => {
    if (inFlightResolves.get(workId) === p) inFlightResolves.delete(workId);
  });
  inFlightResolves.set(workId, p);
  return p;
}

// Background lane for prefetch warms: low concurrency plus a per-work cooldown
// so viewport warming never saturates Suwayomi/DB and slows real clicks.
const BG_CONCURRENCY = 6;
const BG_COOLDOWN_MS = 3_600_000;
const bgQueue: number[] = [];
const bgQueued = new Set<number>();
const bgDoneAt = new Map<number, number>();
let bgActive = 0;

export function queueSourceResolve(workId: number): void {
  const done = bgDoneAt.get(workId);
  if (done && Date.now() - done < BG_COOLDOWN_MS) return;
  if (bgQueued.has(workId) || inFlightResolves.has(workId)) return;
  bgQueued.add(workId);
  bgQueue.push(workId);
  pumpBackground();
}

function pumpBackground() {
  while (bgActive < BG_CONCURRENCY && bgQueue.length) {
    const workId = bgQueue.shift()!;
    bgQueued.delete(workId);
    bgActive += 1;
    bgDoneAt.set(workId, Date.now());
    resolveSourcesForWork(workId, { deep: false })
      .catch(() => {})
      .finally(() => {
        bgActive -= 1;
        pumpBackground();
      });
  }
}

async function doResolveSourcesForWork(
  workId: number,
  opts?: { force?: boolean; deep?: boolean },
): Promise<void> {
  const force = opts?.force ?? false;
  // A viewport warm must not start a three-minute sweep per card.
  const deep = opts?.deep ?? true;

  let work: {
    title: string;
    altTitles: string | null;
    origin: string;
    externalId: string;
    links: { lastSyncedAt: Date | null; chapterCount: number }[];
  } | null;
  try {
    work = await prisma.work.findUnique({
      where: { id: workId },
      select: {
        title: true,
        altTitles: true,
        origin: true,
        externalId: true,
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
  const ref = { origin: work.origin, externalId: work.externalId };
  // Scan sources index Latin titles only, so CJK queries never match; trivial
  // near-duplicates of a queued query add nothing. Both are skipped so a
  // distinct official English alt still makes the query budget.
  const queries: string[] = [];
  for (const t of titles) {
    if (CJK.test(t)) continue;
    if (queries.some((q) => strictSimilarity(q, t) >= 0.9)) continue;
    queries.push(t);
    if (queries.length >= 4) break;
  }

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

  // Solver-backed scrapers cost tens of seconds, so they run detached: the page
  // never waits on them and their links show up on the next poll. Muted sources
  // are swept after the healthy ones, off the clock.
  runScraperLane(workId, queries, titles, ref);

  // Adult-flagged sources stay in the catalogue but go last: the flag marks the
  // whole site, not the work, so they are a real fallback for a normal title
  // nothing else carries. Ordered behind the rest, the sweep reaches them only
  // when it has to.
  const sfw = partitionByHealth(targets.filter((s) => !s.isNsfw));
  const adult = partitionByHealth(targets.filter((s) => s.isNsfw));
  const live = [...sfw.live, ...adult.live];
  const muted = [...sfw.muted, ...adult.muted];
  const deadline = Date.now() + SWEEP_DEADLINE_MS;
  // Best sources go first, so a handful of links usually lands in the first
  // seconds. Once they do, asking the remaining hundreds buys the reader
  // nothing, and every one of those asks can cost a browser-based solve.
  const coverage: Coverage = { hits: 0 };
  const [pending] = await Promise.all([
    runPool(
      live,
      SEARCH_CONCURRENCY,
      deadline,
      (s) => processSource(s, workId, queries, titles, deadline, coverage),
      () => coverage.hits >= ENOUGH_LINKS,
    ),
    // Plain-API sources answer in a second and are the most reliable link a
    // work can get, so they are worth blocking the first paint on.
    runFastScrapers(workId, queries, titles, ref, coverage),
  ]);

  await pruneDuplicateLinks(workId);
  await promotePrimary(workId);

  // Whatever the render budget could not reach still gets searched, just never
  // in front of the reader. It is how a work ends up with every source it has
  // and how a recovered source earns its way back into the fast lane.
  const leftovers = deep ? [...pending, ...muted] : [];
  if (leftovers.length) {
    const retryDeadline = Date.now() + BACKGROUND_SWEEP_MS;
    void runPool(leftovers, SEARCH_CONCURRENCY, retryDeadline, (s) =>
      processSource(s, workId, queries, titles, retryDeadline),
    )
      .then(() => pruneDuplicateLinks(workId))
      .then(() => promotePrimary(workId))
      .catch(() => {});
  }
}

async function runScraper(
  scraper: (typeof SCRAPERS)[number],
  workId: number,
  queries: string[],
  titles: string[],
  ref: { origin: string; externalId: string },
  timeoutMs: number,
  coverage?: Coverage,
): Promise<void> {
  const started = Date.now();
  recordTry(scraper.id);
  try {
    await withTimeout(processScraper(scraper, workId, queries, titles, ref, coverage), timeoutMs);
    recordOk(scraper.id, Date.now() - started);
  } catch {
    recordFail(scraper.id);
  }
}

// Plain-HTTP sources (no challenge solver): fast enough to run inline.
async function runFastScrapers(
  workId: number,
  queries: string[],
  titles: string[],
  ref: { origin: string; externalId: string },
  coverage?: Coverage,
): Promise<void> {
  const scrapers = SCRAPERS.filter(
    (s) => !s.heavy && PREFERRED_LANGS.has(normLang(s.lang)) && !isMuted(s.id),
  );
  if (!scrapers.length) return;
  await Promise.allSettled(
    scrapers.map((s) =>
      runScraper(s, workId, queries, titles, ref, FAST_SCRAPER_TIMEOUT, coverage),
    ),
  );
}

// Detached solver-backed pass, one at a time per work so a second click never
// doubles the browser load.
const scraperLanes = new Set<number>();

function runScraperLane(
  workId: number,
  queries: string[],
  titles: string[],
  ref: { origin: string; externalId: string },
): void {
  if (scraperLanes.has(workId)) return;
  const scrapers = SCRAPERS.filter(
    (s) => s.heavy && PREFERRED_LANGS.has(normLang(s.lang)) && !isMuted(s.id),
  );
  if (!scrapers.length) return;
  scraperLanes.add(workId);
  void Promise.allSettled(
    scrapers.map((s) => runScraper(s, workId, queries, titles, ref, SCRAPER_TIMEOUT)),
  )
    .then(() => pruneDuplicateLinks(workId))
    .then(() => promotePrimary(workId))
    .catch(() => {})
    .finally(() => scraperLanes.delete(workId));
}

// Same scan reachable two ways (a native scraper and a Suwayomi extension for
// the same site) collapses onto one entry, keyed by the manga URL.
const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function dedupeKey(l: { sourceId: string; url: string | null; lang: string | null }): string {
  const raw = (l.url || "").trim().toLowerCase();
  const lang = normLang(l.lang) || "-";
  if (!raw) return `src:${l.sourceId}:${lang}`;
  try {
    const u = new URL(raw);
    const host = u.host.replace(/^www\./, "");
    // A slug tail differs between the engine's URL and ours for the same entry,
    // so an id in the path identifies the manga better than the whole path.
    const id = u.pathname.match(UUID_IN_PATH)?.[0];
    const path = id ?? u.pathname.replace(/\/+$/, "");
    return `url:${host}${path}:${lang}`;
  } catch {
    return `src:${l.sourceId}:${lang}`;
  }
}

type PrunableLink = {
  id: number;
  sourceId: string;
  kind: string;
  url: string | null;
  lang: string | null;
  chapterCount: number;
  healthScore: number;
};

// A native link keeps working when the engine is down, so it wins ties.
function better(a: PrunableLink, b: PrunableLink): boolean {
  if (a.chapterCount !== b.chapterCount) return a.chapterCount > b.chapterCount;
  if (a.kind !== b.kind) return a.kind === "scraper";
  return a.healthScore > b.healthScore;
}

// Collapses several links from the same source onto the richest one. Repairs
// works already polluted by the old multi-match behaviour.
async function pruneDuplicateLinks(workId: number): Promise<void> {
  try {
    const links = await prisma.sourceLink.findMany({
      where: { workId },
      select: {
        id: true,
        sourceId: true,
        kind: true,
        url: true,
        lang: true,
        chapterCount: true,
        healthScore: true,
      },
    });
    const keep = new Map<string, PrunableLink>();
    const drop: number[] = [];
    const push = (key: string, l: PrunableLink) => {
      const cur = keep.get(key);
      if (!cur) {
        keep.set(key, l);
        return;
      }
      if (better(l, cur)) {
        keep.set(key, l);
        drop.push(cur.id);
      } else {
        drop.push(l.id);
      }
    };
    for (const l of links) push(`src:${l.sourceId}`, l);
    const byUrl = new Map<string, PrunableLink>();
    for (const l of keep.values()) {
      const key = dedupeKey(l);
      const cur = byUrl.get(key);
      if (!cur) {
        byUrl.set(key, l);
        continue;
      }
      if (better(l, cur)) {
        byUrl.set(key, l);
        drop.push(cur.id);
      } else {
        drop.push(l.id);
      }
    }
    if (drop.length) await prisma.sourceLink.deleteMany({ where: { id: { in: drop } } });
  } catch (e) {
    console.warn(`[resolve] pruneDuplicateLinks failed (work ${workId})`, e);
  }
}

async function promotePrimary(workId: number): Promise<void> {
  try {
    const links = await prisma.sourceLink.findMany({
      where: { workId },
      orderBy: { healthScore: "desc" },
      select: { id: true },
    });
    if (!links.length) return;
    const topId = links[0].id;
    await prisma.sourceLink.updateMany({
      where: { workId, id: { not: topId } },
      data: { isPrimary: false },
    });
    await prisma.sourceLink.update({ where: { id: topId }, data: { isPrimary: true } });
  } catch (e) {
    console.warn(`[resolve] promote primary failed (work ${workId})`, e);
  }
}

// Unblocks the work page as soon as the first usable link lands instead of
// waiting for the whole sweep to settle.
export async function waitForLinks(
  workId: number,
  opts?: { minLinks?: number; timeoutMs?: number },
): Promise<number> {
  const min = opts?.minLinks ?? 1;
  const deadline = Date.now() + (opts?.timeoutMs ?? 4_000);
  for (;;) {
    const n = await prisma.sourceLink
      .count({ where: { workId, chapterCount: { gt: 0 } } })
      .catch(() => 0);
    if (n >= min) return n;
    if (Date.now() >= deadline) return n;
    await sleep(200);
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
// Fast path for a card click: any known Work resolves straight from the DB.
// Staleness is refreshed off the click path, never in front of the redirect.
export async function lookupRefSlug(
  ref: Pick<WorkRef, "origin" | "externalId">,
): Promise<{ workId: number; slug: string; stale: boolean } | null> {
  const row = await prisma.work
    .findUnique({
      where: { origin_externalId: { origin: ref.origin, externalId: ref.externalId } },
      select: { id: true, slug: true, updatedAt: true },
    })
    .catch(() => null);
  if (!row) return null;
  return {
    workId: row.id,
    slug: row.slug,
    stale: Date.now() - row.updatedAt.getTime() >= REF_FRESH_MS,
  };
}

export async function resolveWorkFromRef(
  ref: WorkRef,
): Promise<{ workId: number; slug: string } | null> {
  try {
    const cached = await lookupRefSlug(ref);
    if (cached && !cached.stale) return { workId: cached.workId, slug: cached.slug };

    let bw: BackboneWork | null = null;

    if (ref.origin === "mangadex") {
      bw = await getMangaDexManga(ref.externalId);
    } else {
      const title = (ref.title || "").trim();
      // MangaDex canonicalization and the Comick policy lookup are independent;
      // running them together halves the cold-open latency.
      const [cands, info] = await Promise.all([
        title ? searchMangaDex(title, 6).catch(() => []) : Promise.resolve([]),
        getComickContentInfo(ref.externalId).catch(() => null),
      ]);
      let best: BackboneWork | null = null;
      let bestScore = 0;
      for (const c of cands) {
        const s = matchScore(title, [c.title, ...c.altTitles]);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (best && bestScore >= MATCH_THRESHOLD && isMatch(bestScore, title, [best.title, ...best.altTitles]))
        bw = best;
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
      // A Comick-only ref carries no genre/rating in the URL, so the detail
      // fetched above feeds the policy guard below.
      if (bw.origin === "comick" && info) {
        bw.genres = info.genres;
        bw.contentRating = info.contentRating;
      }
    }

    if (!bw) return null;

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
