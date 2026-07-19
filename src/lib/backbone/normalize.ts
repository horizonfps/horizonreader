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

// token_sort_ratio: sort both token bags then compare the full strings. Unlike
// token_set, extra tokens on one side lower the score, so a short title is not a
// perfect match for a longer one that merely contains it.
export function tokenSortRatio(a: string, b: string): number {
  const sa = norm(a).split(" ").filter(Boolean).sort().join(" ");
  const sb = norm(b).split(" ").filter(Boolean).sort().join(" ");
  return ratio(sa, sb);
}

// Match decision for cross-source/cross-language titles. token_set alone treats
// a subset title as a 1.0 match ("Veteran Player" vs "A Veteran Player is Needed
// in the Apocalypse"), which glues different works together; requiring token_sort
// too demands real full-string overlap and kills that false positive.
export function titleSimilarity(a: string, b: string): number {
  return Math.min(tokenSetRatio(a, b), tokenSortRatio(a, b));
}

// Best titleSimilarity across every (name, title) pair.
export function bestTitleSimilarity(names: string[], titles: string[]): number {
  let best = 0;
  for (const n of names)
    for (const t of titles) {
      best = Math.max(best, titleSimilarity(n, t));
      if (best >= 1) return best;
    }
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

// Slugs stay ASCII: non-Latin titles would otherwise produce percent-encoded
// URLs whose params never match the stored slug.
export function slugify(title: string, salt: string | number = ""): string {
  const base =
    norm(title)
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .replace(/-+$/, "") || "work";
  return salt ? `${base}-${salt}` : base;
}
