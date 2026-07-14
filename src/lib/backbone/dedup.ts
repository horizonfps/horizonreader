// Cross-source fuzzy dedup: cheap exact-key pre-filter, then Fuse retrieval
// narrowed by token-set scoring.

import Fuse from "fuse.js";
import { norm, bestScore } from "./normalize";
import type { RegistryWork, MatchResult } from "./types";

const MERGE = 0.9;
const REVIEW = 0.8;

// First registry id whose matchKeys intersect the given keys.
export function exactKeyMatch(
  keys: string[],
  registry: { id: number; matchKeys: string[] }[],
): number | null {
  const set = new Set(keys);
  for (const r of registry) {
    for (const k of r.matchKeys) if (set.has(k)) return r.id;
  }
  return null;
}

export function matchWork(
  src: { title: string; altTitles: string[] },
  registry: RegistryWork[],
): MatchResult {
  if (registry.length === 0) return { id: null, score: 0, action: "new" };

  const names = [src.title, ...src.altTitles].filter(Boolean);

  // Fuse retrieval: index each work on its normalized titles (array-valued key).
  const fuse = new Fuse<RegistryWork>(registry, {
    keys: [{ name: "titles", getFn: (w) => w.titles.map((t) => norm(t)) }],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true,
  });

  const candidates = new Map<number, RegistryWork>();
  for (const name of names) {
    const q = norm(name);
    if (!q) continue;
    for (const r of fuse.search(q, { limit: 10 })) candidates.set(r.item.id, r.item);
  }

  // Rescore candidates with the precise token-set ratio; keep the best.
  let best: RegistryWork | null = null;
  let score = 0;
  for (const c of candidates.values()) {
    const s = bestScore(names, c.titles);
    if (s > score) {
      score = s;
      best = c;
    }
  }

  const action: MatchResult["action"] =
    score >= MERGE ? "merge" : score >= REVIEW ? "review" : "new";
  return { id: action === "new" ? null : best!.id, score, action };
}
