// Health memory for scan sources. A Suwayomi extension that keeps timing out is
// muted for a growing cooldown, and healthy sources are searched first, so a
// first open is never held hostage by dead extensions.
//
// Persisted to the /data volume, like solverMemory. The sweep only reaches a
// few dozen of the ~630 sources inside a page budget, so which ones go first
// decides whether a work resolves at all. Keeping this in memory alone meant
// every deploy went back to asking sources in arbitrary order and re-learning
// from zero.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATE_DIR = process.env.SOLVER_STATE_DIR || (existsSync("/data") ? "/data" : ".cache");
const STATE_FILE = join(STATE_DIR, "source-memory.json");
const WRITE_EVERY_MS = 15_000;
const MAX_SOURCES = 2_000;

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

function load(): Map<string, Stat> {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
      v?: number;
      sources?: Record<string, Stat>;
    };
    if (raw.v !== 1 || !raw.sources) return new Map();
    // Mutes are deliberately not persisted: a restart is a fair moment to give
    // a source another chance.
    return new Map(
      Object.entries(raw.sources).map(([id, s]) => [id, { ...s, streak: 0, mutedUntil: 0 }]),
    );
  } catch {
    return new Map();
  }
}

const stats = load();

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persist();
  }, WRITE_EVERY_MS);
  writeTimer.unref?.();
}

async function persist(): Promise<void> {
  try {
    if (stats.size > MAX_SOURCES) {
      const leastUsed = [...stats.entries()].sort(
        (a, b) => a[1].ok + a[1].fail - (b[1].ok + b[1].fail),
      );
      for (const [k] of leastUsed) {
        if (stats.size <= MAX_SOURCES) break;
        stats.delete(k);
      }
    }
    await mkdir(STATE_DIR, { recursive: true });
    const body = JSON.stringify({ v: 1, sources: Object.fromEntries(stats) });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, STATE_FILE);
  } catch {
    /* memory is best-effort */
  }
}

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
  scheduleWrite();
}

export function recordTry(id: string): void {
  statFor(id).tries += 1;
  scheduleWrite();
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
  scheduleWrite();
}

export function recordFail(id: string): void {
  const s = statFor(id);
  s.fail += 1;
  s.streak += 1;
  if (s.streak >= MUTE_AFTER) {
    const backoff = MUTE_BASE_MS * 2 ** (s.streak - MUTE_AFTER);
    s.mutedUntil = Date.now() + Math.min(backoff, MUTE_MAX_MS);
  }
  scheduleWrite();
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
