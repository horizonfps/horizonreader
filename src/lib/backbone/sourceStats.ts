// Live health memory for scan sources. A Suwayomi extension that keeps timing
// out is muted for a growing cooldown, and healthy sources are searched first,
// so a first open is never held hostage by dead extensions.

type Stat = {
  ok: number;
  fail: number;
  hits: number;
  tries: number;
  streak: number;
  avgMs: number;
  mutedUntil: number;
};

const MUTE_AFTER = 2;
const MUTE_BASE_MS = 5 * 60_000;
const MUTE_MAX_MS = 6 * 3_600_000;
// Prior latency for a source never searched yet: optimistic enough to be tried
// early, high enough that proven-fast sources still go first.
const UNKNOWN_MS = 1_500;

const stats = new Map<string, Stat>();

function statFor(id: string): Stat {
  let s = stats.get(id);
  if (!s)
    stats.set(
      id,
      (s = { ok: 0, fail: 0, hits: 0, tries: 0, streak: 0, avgMs: UNKNOWN_MS, mutedUntil: 0 }),
    );
  return s;
}

// A source that answers fast but never carries the work is worthless to a
// sweep that stops at the first few links, so hit rate has to outrank latency.
export function recordHit(id: string): void {
  statFor(id).hits += 1;
}

export function recordTry(id: string): void {
  statFor(id).tries += 1;
}

// Laplace-smoothed, so a source never tried yet sits mid-pack instead of
// leading on an empty record or being buried behind proven ones.
function hitRate(s: Stat | undefined): number {
  if (!s) return 0.5;
  return (s.hits + 1) / (s.tries + 2);
}

export function isMuted(id: string): boolean {
  const s = stats.get(id);
  return !!s && s.mutedUntil > Date.now();
}

export function recordOk(id: string, ms: number): void {
  const s = statFor(id);
  s.ok += 1;
  s.streak = 0;
  s.mutedUntil = 0;
  s.avgMs = s.ok === 1 ? ms : s.avgMs * 0.7 + ms * 0.3;
}

export function recordFail(id: string): void {
  const s = statFor(id);
  s.fail += 1;
  s.streak += 1;
  if (s.streak >= MUTE_AFTER) {
    const backoff = MUTE_BASE_MS * 2 ** (s.streak - MUTE_AFTER);
    s.mutedUntil = Date.now() + Math.min(backoff, MUTE_MAX_MS);
  }
}

// Splits into the sources worth blocking a request on and the muted ones, each
// ordered best-first: the ones that actually carry works, then the fast ones.
export function partitionByHealth<T extends { id: string }>(sources: T[]): { live: T[]; muted: T[] } {
  const live: T[] = [];
  const muted: T[] = [];
  for (const s of sources) (isMuted(s.id) ? muted : live).push(s);
  const byValue = (a: T, b: T) => {
    const rate = hitRate(stats.get(b.id)) - hitRate(stats.get(a.id));
    if (Math.abs(rate) > 0.01) return rate;
    return (stats.get(a.id)?.avgMs ?? UNKNOWN_MS) - (stats.get(b.id)?.avgMs ?? UNKNOWN_MS);
  };
  live.sort(byValue);
  muted.sort(byValue);
  return { live, muted };
}

export function sourceStatsSnapshot(): Record<string, Stat> {
  return Object.fromEntries(stats);
}
