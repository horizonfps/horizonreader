// Scan-source health scoring: rank which source is healthiest for a Work.

import type { HealthInput } from "./types";

// Keyword -> quality prior. Longer/more specific keys don't need ordering;
// first match wins per tier, high tier checked before mid tier.
const HIGH: Array<[string, number]> = [
  ["mangadex", 1.0],
  ["mangaplus", 1.0],
  ["shueisha", 1.0],
  ["official", 1.0],
  ["comick", 0.98],
  ["batoto", 0.95],
  ["asura", 0.95],
  ["flame", 0.92],
  ["reaper", 0.92],
  ["weeb", 0.9],
];

const MID: Array<[string, number]> = [
  ["manganato", 0.6],
  ["manganelo", 0.6],
  ["mangakakalot", 0.58],
  ["mangakatana", 0.55],
  ["mangapill", 0.55],
  ["mangafox", 0.52],
  ["mangahere", 0.52],
  ["mangaread", 0.55],
  ["flower", 0.5],
  // pt-BR scan sources
  ["sussytoons", 0.62],
  ["sussy", 0.6],
  ["neox", 0.58],
  ["argos", 0.58],
  ["slaverse", 0.56],
  ["yushuke", 0.55],
  ["mangalivre", 0.55],
  ["union", 0.54],
  ["rede manga", 0.52],
  ["mangas chan", 0.52],
];

export function sourcePrior(sourceName?: string | null): number {
  const s = (sourceName || "").toLowerCase();
  if (!s) return 0.4;
  for (const [kw, p] of HIGH) if (s.includes(kw)) return p;
  for (const [kw, p] of MID) if (s.includes(kw)) return p;
  return 0.4;
}

const DAY_MS = 86_400_000;

function recencyScore(latestAt?: Date | null): number {
  if (!latestAt) return 0;
  const t = latestAt.getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (Date.now() - t) / DAY_MS;
  if (days <= 7) return 30;
  if (days >= 365) return 0;
  const frac = 1 - (days - 7) / (365 - 7);
  return frac * 30;
}

export function scoreSourceLink(input: HealthInput): number {
  const count = Math.max(0, input.chapterCount || 0);
  const chapters = Math.min(1, Math.log(1 + count) / Math.log(1 + 300)) * 50;
  const recency = recencyScore(input.latestAt);
  const prior = sourcePrior(input.sourceName) * 20;
  return Math.round((chapters + recency + prior) * 10) / 10;
}

export function rankLinks<T extends HealthInput & { id?: number }>(links: T[]): T[] {
  return links
    .map((link, i) => ({ link, i, score: scoreSourceLink(link) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.link);
}
