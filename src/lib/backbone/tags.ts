// MangaDex genre tag resolver: name/slug -> tag UUID. Server-side only.

import { getMangaDexTags } from "@/lib/backbone/mangadex";

const TTL = 24 * 60 * 60 * 1000;

let cache: { map: Map<string, string>; at: number } | null = null;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Keys are lowercased tag name AND derived slug; value is the tag UUID.
export async function getTagMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.map;

  try {
    const tags = await getMangaDexTags();
    const map = new Map<string, string>();
    for (const t of tags) {
      if (!t.id || !t.name) continue;
      map.set(t.name.toLowerCase(), t.id);
      map.set(slugify(t.name), t.id);
    }
    if (map.size) {
      cache = { map, at: now };
      return map;
    }
    return cache?.map ?? map;
  } catch {
    return cache?.map ?? new Map();
  }
}

export async function resolveGenreTag(nameOrSlug: string): Promise<string | null> {
  const q = (nameOrSlug || "").trim();
  if (!q) return null;
  const map = await getTagMap();
  return map.get(q.toLowerCase()) ?? map.get(slugify(q)) ?? null;
}
