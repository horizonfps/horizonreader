// Content policy: hide pornographic (hentai/erotica) and BL/GL/LGBT works from
// every discovery surface. +18 by gore/violence stays visible. Pure + isomorphic
// (no server-only imports) so client bundles and API routes can share it.

// MangaDex genre tag UUIDs to exclude at the source query.
export const BLOCKED_MDX_TAGS = [
  "5920b825-4181-4a17-beeb-9918b0ff7a30", // Boys' Love
  "a3c67850-4684-404e-9b7f-c69850ee5da6", // Girls' Love
];

// Genre-name phrases that flag BL/GL/LGBT or explicit sexual content.
const BLOCKED_GENRE_PHRASES = [
  "boys love",
  "girls love",
  "yaoi",
  "yuri",
  "shounen ai",
  "shoujo ai",
  "shonen ai",
  "shojo ai",
  "lgbt",
  "gay",
  "lesbian",
  "bara",
  "hentai",
  "smut",
];

const BLOCKED_GENRE_TOKENS = new Set(["bl", "gl"]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isBlockedGenres(genres?: string[] | null): boolean {
  if (!genres || genres.length === 0) return false;
  for (const g of genres) {
    if (typeof g !== "string" || !g) continue;
    const n = normalize(g);
    if (!n) continue;
    if (BLOCKED_GENRE_PHRASES.some((p) => n.includes(p))) return true;
    if (n.split(" ").some((tok) => BLOCKED_GENRE_TOKENS.has(tok))) return true;
  }
  return false;
}

// Only explicit sexual ratings are blocked; "safe"/"suggestive" pass.
export function isBlockedRating(rating?: string | null): boolean {
  if (!rating) return false;
  return /porn|erotic|hentai|adult|smut|nsfw|18\+/i.test(rating);
}

export function isBlocked(input: {
  genres?: string[] | null;
  contentRating?: string | null;
}): boolean {
  return isBlockedRating(input.contentRating) || isBlockedGenres(input.genres);
}
