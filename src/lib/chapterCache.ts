// Short-TTL in-memory cache for chapter lists, keyed per source link, so
// repeat work-page views skip the Suwayomi/DB round-trip.

const TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { data: unknown; at: number }>();

export function chapterCacheKey(link: {
  id: number;
  kind?: string | null;
  sourceMangaId: number;
}): string {
  return link.kind === "scraper" ? `n:${link.id}` : `s:${link.sourceMangaId}`;
}

export function getCachedChapters<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL) return null;
  return hit.data as T;
}

export function setCachedChapters(key: string, data: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, { data, at: Date.now() });
}

export function bustChapters(keys: string[]): void {
  for (const k of keys) cache.delete(k);
}
