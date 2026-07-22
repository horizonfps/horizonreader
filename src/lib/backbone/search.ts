// Unified work search: local catalog + MangaDex + Comick in parallel, merged,
// deduped and ranked by relevance to the query. Server-side only.

import { prisma } from "@/lib/db";
import type { BackboneWork } from "@/lib/backbone/types";
import { searchMangaDex, getMangaDexStatistics } from "@/lib/backbone/mangadex";
import { searchComick } from "@/lib/backbone/comick";
import { isBlocked } from "@/lib/backbone/filter";
import { norm, titleSimilarity } from "@/lib/backbone/normalize";
import { attachLocalSlugs } from "@/lib/backbone/localslugs";
import { backboneToCard, type Card } from "@/lib/cards";

const REMOTE_TIMEOUT_MS = 6_000;
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;
const LOCAL_TAKE = 20;
const RESULT_CAP = 30;
const MIN_SCORE = 0.3;

const cache = new Map<string, { items: Card[]; at: number }>();

function getCached(key: string): Card[] | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL) return null;
  return hit.items;
}

function setCached(key: string, items: Card[]): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, { items, at: Date.now() });
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((r) => setTimeout(() => r(fallback), ms)),
  ]);
}

function parseArr(json?: string | null): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

// Dedupe key that keeps bracketed qualifiers: norm() strips them, which would
// collapse variant editions onto the base work and drop one of them.
function titleKey(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Derivative editions rank below the base work: MangaDex floods short queries
// with doujinshi before the main title.
const VARIANT =
  /doujinshi|fanbook|fan\s?colou?red|official\s?colou?red|anthology|art\s?book|guide\s?book|character guide|novel/i;
const VARIANT_PENALTY = 0.4;

// Fuzzy similarity plus exact/prefix/substring bonuses so short queries still
// rank their obvious target first.
function relevance(q: string, nq: string, titles: string[]): number {
  let best = 0;
  for (const t of titles) {
    const nt = norm(t);
    if (!nt) continue;
    let s = titleSimilarity(q, t);
    if (nt === nq) s += 0.6;
    else if (nt.startsWith(nq)) s += 0.45;
    else if (nt.includes(nq)) s += 0.3;
    if (s > best) best = s;
  }
  return best;
}

type Scored = { card: Card; titles: string[]; score: number; follows: number };

// A local hit opens instantly and is preferred; MangaDex beats Comick because
// Comick refs canonicalize onto MangaDex anyway.
function priority(s: Scored): number {
  return (s.card.localSlug ? 2 : 0) + (s.card.origin === "mangadex" ? 1 : 0);
}

async function searchLocal(q: string, nq: string): Promise<Scored[]> {
  const rows = await prisma.work
    .findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { altTitles: { contains: q } },
          ...(nq ? [{ matchKeys: { contains: nq } }] : []),
        ],
      },
      select: {
        slug: true,
        origin: true,
        externalId: true,
        title: true,
        altTitles: true,
        coverUrl: true,
        type: true,
        status: true,
        rating: true,
        follows: true,
        genres: true,
        contentRating: true,
      },
      take: LOCAL_TAKE,
    })
    .catch(() => []);

  const out: Scored[] = [];
  for (const w of rows) {
    const genres = parseArr(w.genres);
    if (isBlocked({ genres, contentRating: w.contentRating })) continue;
    const titles = [w.title, ...parseArr(w.altTitles)];
    const penalty = VARIANT.test(w.title) ? VARIANT_PENALTY : 0;
    out.push({
      card: {
        origin: w.origin === "comick" ? "comick" : "mangadex",
        externalId: w.externalId,
        slug: null,
        localSlug: w.slug,
        title: w.title,
        coverUrl: w.coverUrl,
        type: (w.type as Card["type"]) ?? null,
        status: (w.status as Card["status"]) ?? null,
        rating: w.rating,
        chapterCount: null,
        genres,
        contentRating: w.contentRating,
      },
      titles,
      score: relevance(q, nq, titles) - penalty,
      follows: w.follows ?? 0,
    });
  }
  return out;
}

function remoteToScored(q: string, nq: string, works: BackboneWork[]): Scored[] {
  const out: Scored[] = [];
  for (const bw of works) {
    if (isBlocked({ genres: bw.genres, contentRating: bw.contentRating })) continue;
    const titles = [bw.title, ...(bw.altTitles ?? [])].filter(Boolean);
    const penalty = VARIANT.test(bw.title) ? VARIANT_PENALTY : 0;
    out.push({
      card: backboneToCard(bw),
      titles,
      score: relevance(q, nq, titles) - penalty,
      follows: bw.follows ?? 0,
    });
  }
  return out;
}

export async function searchWorks(q: string): Promise<Card[]> {
  const query = q.trim();
  if (!query) return [];
  const nq = norm(query);
  const key = nq || query.toLowerCase();

  const cached = getCached(key);
  if (cached) return cached;

  const [local, mdx, ck] = await Promise.all([
    searchLocal(query, nq),
    query.length >= 2
      ? withTimeout(searchMangaDex(query, 24), REMOTE_TIMEOUT_MS, [] as BackboneWork[])
      : Promise.resolve([] as BackboneWork[]),
    query.length >= 2
      ? withTimeout(searchComick(query), REMOTE_TIMEOUT_MS, [] as BackboneWork[])
      : Promise.resolve([] as BackboneWork[]),
  ]);

  // Follows/rating break score ties (the base work vs. its spinoffs) and give
  // the cards real ratings; skipped silently when the stats call is slow.
  if (mdx.length) {
    const stats = await withTimeout(
      getMangaDexStatistics(mdx.map((w) => w.externalId)),
      4_000,
      {} as Awaited<ReturnType<typeof getMangaDexStatistics>>,
    );
    for (const w of mdx) {
      const st = stats[w.externalId];
      if (st) {
        w.rating = st.rating ?? w.rating ?? null;
        w.follows = st.follows ?? w.follows ?? null;
      }
    }
  }

  const all = [...local, ...remoteToScored(query, nq, mdx), ...remoteToScored(query, nq, ck)];

  // Dedupe by exact id, then by normalized primary title (the same work seen
  // through MangaDex and Comick), keeping the highest-priority entry.
  const merge = (map: Map<string, Scored>, key: string, s: Scored) => {
    const prev = map.get(key);
    if (!prev) {
      map.set(key, s);
      return;
    }
    const keep =
      priority(s) > priority(prev) || (priority(s) === priority(prev) && s.follows > prev.follows)
        ? s
        : prev;
    keep.score = Math.max(s.score, prev.score);
    keep.follows = Math.max(s.follows, prev.follows);
    map.set(key, keep);
  };

  const byId = new Map<string, Scored>();
  for (const s of all) merge(byId, `${s.card.origin}:${s.card.externalId}`, s);
  const byTitle = new Map<string, Scored>();
  for (const s of byId.values()) merge(byTitle, titleKey(s.card.title), s);

  const items = [...byTitle.values()]
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.follows - a.follows || (b.card.rating ?? 0) - (a.card.rating ?? 0))
    .slice(0, RESULT_CAP)
    .map((s) => s.card);

  await attachLocalSlugs([items]);

  if (items.length) setCached(key, items);
  return items;
}
