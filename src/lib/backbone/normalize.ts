// Title normalization + fuzzy scoring for cross-language matching.
// Three views of a title are compared: normalized, romanization-folded (so
// shounen/shonen/shōnen collapse), and a core view with particles and edition
// noise stripped. The best view wins, which is what keeps a work from being
// thrown away over a spelling variant.

import { distance } from "fastest-levenshtein";

const BRACKETS = /[[(（【][^\])）】]*[\])）】]/g;
// Strip volume/season/part markers that create false distinctions between
// otherwise-identical works. Kept conservative (no bare roman-numeral stripping).
const MARKERS =
  /\b(season|part|pt|vol|volume|cour|arc)\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b|\b(2nd|3rd|final)\s+season\b/gi;
// Tilde-delimited subtitles are decoration on the japanese side of a title.
const TILDE_SUB = /[~〜～][^~〜～]*[~〜～]?/g;

export function norm(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(BRACKETS, " ")
    .replace(/&/g, " and ")
    .replace(MARKERS, " ")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // strip combining diacritics (ō -> o, ū -> u)
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // drop punctuation, keep letters/numbers
    .replace(/\s+/g, " ")
    .trim();
}

// Particles and articles that carry no identity, across en/ja-romaji/pt.
const STOP = new Set([
  "the", "a", "an", "of", "and", "to", "in", "on", "at", "for", "with", "is",
  "no", "wa", "ga", "ni", "wo", "o", "ha", "de", "da", "e", "mo", "ya", "na", "ne",
  "os", "as", "do", "dos", "das", "um", "uma", "que", "se", "por", "com", "para",
  "el", "la", "los", "las", "le", "les", "du", "des", "il",
]);

// Edition/format decoration that scan sites bolt onto a title.
const NOISE = new Set([
  "official", "colored", "coloured", "color", "colour", "digital", "comic",
  "comics", "manga", "manhwa", "manhua", "webtoon", "novel", "raw", "fan",
  "full", "completo", "oficial", "edition", "edicao", "scan", "scans", "br",
  "portugues", "traducao", "online", "leitura",
]);

// Tokens that mark a different entry in a franchise; used to refuse a subset
// match like "Solo Leveling" vs "Solo Leveling: Ragnarok".
const SEQUEL = new Set([
  "ii", "iii", "iv", "vi", "vii", "viii", "ix", "x", "xi", "xii",
  "season", "part", "gaiden", "spinoff", "spin", "off", "side", "sequel",
  "prequel", "after", "aftermath", "before", "origin", "origins", "zero",
  "remake", "reboot", "returns", "return", "next", "final", "act", "arc",
  "ragnarok", "legacy", "reloaded", "revenge", "rebirth", "encore", "extra",
  "special", "specials", "oneshot", "omake", "anthology", "doujinshi",
  "fanbook", "artbook", "guidebook", "reprint", "remastered",
]);

function tokens(s: string): string[] {
  return s.split(" ").filter(Boolean);
}

// Fold japanese romanization variants onto one spelling. Applied to both sides,
// so the english collateral (you -> yo) is symmetric and harmless.
export function romanFold(s: string): string {
  return s
    .replace(/ou/g, "o")
    .replace(/\bwo\b/g, "o")
    .replace(/sy(?=[auo])/g, "sh")
    .replace(/jy(?=[auo])/g, "j")
    .replace(/ty(?=[auo])/g, "ch")
    .replace(/m(?=[bp])/g, "n")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function core(s: string): string {
  const kept = tokens(s).filter((t) => !STOP.has(t) && !NOISE.has(t));
  return kept.length ? kept.join(" ") : s;
}

const ratio = (a: string, b: string) =>
  !a && !b ? 1 : 1 - distance(a, b) / Math.max(a.length, b.length);

// fuzzywuzzy-style token_set_ratio: robust to word reordering + extra tokens.
export function tokenSetRatio(a: string, b: string): number {
  return tokenSetOn(norm(a), norm(b));
}

function tokenSetOn(na: string, nb: string): number {
  const ta = new Set(tokens(na));
  const tb = new Set(tokens(nb));
  const inter = [...ta].filter((x) => tb.has(x)).sort();
  const restA = [...ta].filter((x) => !tb.has(x)).sort();
  const restB = [...tb].filter((x) => !ta.has(x)).sort();
  const s0 = inter.join(" ");
  const s1 = [...inter, ...restA].join(" ").trim();
  const s2 = [...inter, ...restB].join(" ").trim();
  return Math.max(ratio(s0, s1), ratio(s0, s2), ratio(s1, s2));
}

// token_sort_ratio: sort both token bags then compare the full strings. Extra
// tokens on one side lower the score, unlike token_set.
export function tokenSortRatio(a: string, b: string): number {
  return tokenSortOn(norm(a), norm(b));
}

function tokenSortOn(na: string, nb: string): number {
  return ratio(tokens(na).sort().join(" "), tokens(nb).sort().join(" "));
}

// Sørensen-Dice on character bigrams: forgiving of insertions and typos in a
// way edit distance on the whole string is not.
function diceOn(na: string, nb: string): number {
  const a = na.replace(/\s+/g, "");
  const b = nb.replace(/\s+/g, "");
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      counts.set(g, c - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

function combine(na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 0.45 * tokenSortOn(na, nb) + 0.25 * tokenSetOn(na, nb) + 0.3 * diceOn(na, nb);
}

type View = {
  plain: string;
  folded: string;
  core: string;
  squashed: string; // folded with spaces dropped: "Daiakutou" == "Dai Akutou"
  segments: string[]; // folded parts of a punctuation-delimited title
};

// Colon/dash/slash separated parts: an official title glued to its native one.
const SEGMENT_SPLIT = /[:：\-–—/|｜]|\s[~〜～]\s?/;

const viewCache = new Map<string, View>();

function viewOf(title: string): View {
  const hit = viewCache.get(title);
  if (hit) return hit;
  const cleaned = (title || "").replace(BRACKETS, " ").replace(TILDE_SUB, " ");
  const plain = norm(cleaned);
  const folded = romanFold(plain);
  const parts = cleaned.split(SEGMENT_SPLIT).map((p) => romanFold(norm(p))).filter(Boolean);
  const v: View = {
    plain,
    folded,
    core: romanFold(core(plain)),
    squashed: folded.replace(/\s+/g, ""),
    segments: parts.length > 1 ? parts : [],
  };
  if (viewCache.size > 5_000) viewCache.clear();
  viewCache.set(title, v);
  return v;
}

// Conservative metric: a subset title never scores 1.0. Used where merging two
// works wrongly is worse than keeping them apart.
export function strictSimilarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  return Math.min(tokenSetOn(na, nb), tokenSortOn(na, nb));
}

// Match metric for cross-source/cross-language titles: best of the three views.
export function titleSimilarity(a: string, b: string): number {
  const va = viewOf(a);
  const vb = viewOf(b);
  return Math.max(
    combine(va.plain, vb.plain),
    combine(va.folded, vb.folded),
    combine(va.core, vb.core) * 0.99,
    // Word boundaries move between sources ("Daiakutou" vs "Dai Akutou"), so
    // the spaceless spelling gets its own comparison.
    combine(va.squashed, vb.squashed) * 0.99,
  );
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

// Best token-set ratio across every (name, title) pair.
export function bestScore(names: string[], titles: string[]): number {
  let best = 0;
  for (const n of names) for (const t of titles) best = Math.max(best, tokenSetRatio(n, t));
  return best;
}

// A short title carries little evidence, so it has to match harder: "Reborn"
// is one edit away from half the catalogue.
function thresholdFor(tokenCount: number, len: number): number {
  if (tokenCount <= 1) return len <= 6 ? 0.95 : 0.9;
  if (tokenCount === 2) return 0.86;
  if (tokenCount === 3) return 0.82;
  return 0.78;
}

// One side's title fully contained in the other's. The pair is the same work
// often enough ("Kimetsu no Yaiba" vs "Demon Slayer: Kimetsu no Yaiba") that
// refusing it outright is what leaves works with no source at all. Containment
// alone is not enough: the shorter title must sit in the longer one as a whole
// segment or as its opening, and the extra words must not mark a spin-off.
function subsetAccepts(a: View, b: View): boolean {
  const [small, big] = a.folded.length <= b.folded.length ? [a, b] : [b, a];
  const smallTokens = tokens(small.folded);
  const bigTokens = new Set(tokens(big.folded));
  if (smallTokens.length < 2 || small.folded.length < 12) return false;
  for (const t of smallTokens) if (!bigTokens.has(t)) return false;

  const smallSet = new Set(smallTokens);
  for (const t of bigTokens) if (!smallSet.has(t) && (SEQUEL.has(t) || /\d/.test(t))) return false;

  if (big.folded.startsWith(small.folded)) return true;
  return big.segments.some((seg) => seg === small.folded);
}

export function matchScore(candidate: string, aliases: string[]): number {
  let best = 0;
  for (const a of aliases) {
    if (!a) continue;
    best = Math.max(best, titleSimilarity(candidate, a));
    if (best >= 1) break;
  }
  return best;
}

// Accept decision for "is this search result the same work". Score first, then
// the subset rule as a second chance.
export function isMatch(score: number, candidate: string, aliases: string[]): boolean {
  const vc = viewOf(candidate);
  const cTokens = tokens(vc.plain);
  if (!cTokens.length) return false;

  for (const a of aliases) {
    if (!a) continue;
    const va = viewOf(a);
    const aTokens = tokens(va.plain);
    if (!aTokens.length) continue;
    const minTokens = Math.min(cTokens.length, aTokens.length);
    const minLen = Math.min(vc.plain.length, va.plain.length);
    if (score >= thresholdFor(minTokens, minLen)) return true;
    if (score >= 0.6 && subsetAccepts(vc, va)) return true;
  }
  return false;
}

// Convenience wrapper: score + decide in one call.
export function matches(candidate: string, aliases: string[]): boolean {
  return isMatch(matchScore(candidate, aliases), candidate, aliases);
}

// Distinct normalized keys for a set of titles (stored on Work for exact lookup).
// Both the plain and folded spellings are kept so a romanization variant still
// hits the indexed pre-filter.
export function matchKeys(titles: string[]): string[] {
  const keys = new Set<string>();
  for (const t of titles) {
    const n = norm(t);
    if (!n) continue;
    keys.add(n);
    const f = romanFold(n);
    if (f) keys.add(f);
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
