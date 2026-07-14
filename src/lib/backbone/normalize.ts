// Title normalization + fuzzy scoring for cross-language dedup.
// Strategy: aggressive normalize -> exact key match; fall back to token_set_ratio.

import { distance } from "fastest-levenshtein";

const BRACKETS = /[[(（【][^\])）】]*[\])）】]/g;
// Strip volume/season/part markers that create false distinctions between
// otherwise-identical works. Kept conservative (no bare roman-numeral stripping).
const MARKERS =
  /\b(season|part|pt|vol|volume|cour|arc)\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b|\b(2nd|3rd|final)\s+season\b/gi;

export function norm(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(BRACKETS, " ")
    .replace(/&/g, " and ")
    .replace(MARKERS, " ")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // strip combining diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // drop punctuation, keep letters/numbers
    .replace(/\s+/g, " ")
    .trim();
}

const ratio = (a: string, b: string) =>
  !a && !b ? 1 : 1 - distance(a, b) / Math.max(a.length, b.length);

// fuzzywuzzy-style token_set_ratio: robust to word reordering + extra tokens.
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  const inter = [...ta].filter((x) => tb.has(x)).sort();
  const restA = [...ta].filter((x) => !tb.has(x)).sort();
  const restB = [...tb].filter((x) => !ta.has(x)).sort();
  const s0 = inter.join(" ");
  const s1 = [...inter, ...restA].join(" ").trim();
  const s2 = [...inter, ...restB].join(" ").trim();
  return Math.max(ratio(s0, s1), ratio(s0, s2), ratio(s1, s2));
}

// Best token-set ratio across every (name, title) pair.
export function bestScore(names: string[], titles: string[]): number {
  let best = 0;
  for (const n of names) for (const t of titles) best = Math.max(best, tokenSetRatio(n, t));
  return best;
}

// Distinct normalized keys for a set of titles (stored on Work for exact lookup).
export function matchKeys(titles: string[]): string[] {
  const keys = new Set<string>();
  for (const t of titles) {
    const n = norm(t);
    if (n) keys.add(n);
  }
  return [...keys];
}

export function slugify(title: string, salt: string | number = ""): string {
  const base = norm(title).replace(/\s+/g, "-").slice(0, 60) || "work";
  return salt ? `${base}-${salt}` : base;
}
