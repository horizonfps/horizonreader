// Cross-source chapter identity: number, name and upload date. Sources number
// the same chapter differently (or not at all), so the number alone loses the
// match. Pure module, no db and no network.

import { uploadMs } from "./chapters.ts";

export type MatchChapter = {
  id: number;
  name?: string | null;
  chapterNumber?: number | null;
  uploadDate?: string | null;
};

export const MATCH_ACCEPT = 0.4;

const COMBINING = /[̀-ͯ]/g;
const LABEL_PREFIX = /^(capitulo|cap|chapter|chap|ch|episodio|ep)\b[\s.:#\-–—]*/;
const SAME_UPLOAD_MS = 12 * 3_600_000;

function stripLabels(name?: string | null): string {
  let s = (name || "").toLowerCase().normalize("NFD").replace(COMBINING, "").trim();
  while (LABEL_PREFIX.test(s)) s = s.replace(LABEL_PREFIX, "");
  return s;
}

// Comparable name, label prefixes and punctuation gone. A name that is only the
// number adds nothing the number does not already say.
export function chapterNameKey(name?: string | null): string {
  const key = stripLabels(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^[\d.]+$/.test(key) ? "" : key;
}

export function numberFromName(name?: string | null): number {
  const m = stripLabels(name).match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 1 same number, 0.8 same name, 0.4 same upload window, 0 otherwise.
export function matchScore(a: MatchChapter, b: MatchChapter): number {
  const numOf = (c: MatchChapter) => {
    const n = Number(c.chapterNumber);
    return Number.isFinite(n) && n > 0 ? n : numberFromName(c.name);
  };
  const na = numOf(a);
  const nb = numOf(b);
  const ka = chapterNameKey(a.name);
  const kb = chapterNameKey(b.name);
  const ta = uploadMs(a);
  const tb = uploadMs(b);

  if (na > 0 && nb > 0) {
    if (na === nb) return 1;
    // Different numbers say different chapters, unless the names are identical:
    // one source numbers per season, the other straight through.
    if (ka && ka === kb) return 0.8;
    return 0;
  }
  if (ka && ka === kb) return 0.8;
  if (ta && tb && Math.abs(ta - tb) <= SAME_UPLOAD_MS) return 0.4;
  return 0;
}

export function findChapterMatch<T extends MatchChapter>(
  target: MatchChapter,
  candidates: T[],
): T | null {
  const targetMs = uploadMs(target);
  let best: T | null = null;
  let bestScore = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (c.id === target.id) continue;
    const score = matchScore(target, c);
    if (score <= 0) continue;
    const cMs = uploadMs(c);
    const gap = targetMs && cMs ? Math.abs(targetMs - cMs) : Number.POSITIVE_INFINITY;
    const better =
      !best ||
      score > bestScore ||
      (score === bestScore && (gap < bestGap || (gap === bestGap && c.id < best.id)));
    if (better) {
      best = c;
      bestScore = score;
      bestGap = gap;
    }
  }
  return best && bestScore >= MATCH_ACCEPT ? best : null;
}
