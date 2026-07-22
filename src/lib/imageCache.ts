// Byte-capped in-memory LRU for proxied images (covers/thumbnails), so repeat
// views skip the upstream fetch entirely.

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024;
const TTL = 7 * 24 * 60 * 60 * 1000;

type Entry = { body: Uint8Array; contentType: string; at: number };

const cache = new Map<string, Entry>();
let totalBytes = 0;

export function getCachedImage(key: string): Entry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL) {
    cache.delete(key);
    totalBytes -= hit.body.byteLength;
    return null;
  }
  // Refresh recency (Map preserves insertion order).
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setCachedImage(key: string, body: Uint8Array, contentType: string): void {
  if (body.byteLength === 0 || body.byteLength > MAX_ENTRY_BYTES) return;
  const prev = cache.get(key);
  if (prev) {
    cache.delete(key);
    totalBytes -= prev.body.byteLength;
  }
  while (totalBytes + body.byteLength > MAX_BYTES && cache.size) {
    const oldest = cache.keys().next().value!;
    const evicted = cache.get(oldest)!;
    cache.delete(oldest);
    totalBytes -= evicted.body.byteLength;
  }
  cache.set(key, { body, contentType, at: Date.now() });
  totalBytes += body.byteLength;
}
