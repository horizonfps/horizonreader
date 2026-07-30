// Cross-restart memory of which challenge solver wins (or only fails) on each
// host. Same idea as sourceStats.ts, but written to the /data volume: a
// restart used to zero the scoreboard and send every host back through the
// solver that only fails there, one browser boot per attempt.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATE_DIR = process.env.SOLVER_STATE_DIR || (existsSync("/data") ? "/data" : ".cache");
const STATE_FILE = join(STATE_DIR, "solver-memory.json");

const BENCH_AFTER = 3;
const BENCH_TTL_MS = 6 * 3_600_000;
const MAX_PAIRS = 800;
const WRITE_EVERY_MS = 10_000;

type PairStat = {
  ok: number;
  fail: number;
  streak: number;
  avgMs: number;
  lastOkAt: number;
  lastFailAt: number;
};

function pairKey(kind: string, host: string): string {
  return `${kind}|${host}`;
}

function splitKey(k: string): { kind: string; host: string } {
  const i = k.indexOf("|");
  return { kind: k.slice(0, i), host: k.slice(i + 1) };
}

function load(): Map<string, PairStat> {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
      v?: number;
      pairs?: Record<string, PairStat>;
    };
    if (raw.v !== 1 || !raw.pairs) return new Map();
    return new Map(Object.entries(raw.pairs));
  } catch {
    // Missing file, invalid JSON, or a future version: start empty rather
    // than throw, so a corrupt file never blocks the first request.
    return new Map();
  }
}

const pairs = load();

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void persist();
  }, WRITE_EVERY_MS);
  writeTimer.unref?.();
}

// Keeps the file small by dropping the pairs nobody has touched in the
// longest time, win or lose.
function evictOldest(): void {
  if (pairs.size <= MAX_PAIRS) return;
  const oldestFirst = [...pairs.entries()].sort(
    (a, b) => Math.max(a[1].lastOkAt, a[1].lastFailAt) - Math.max(b[1].lastOkAt, b[1].lastFailAt),
  );
  for (const [k] of oldestFirst) {
    if (pairs.size <= MAX_PAIRS) break;
    pairs.delete(k);
  }
}

async function persist(): Promise<void> {
  try {
    evictOldest();
    await mkdir(STATE_DIR, { recursive: true });
    const body = JSON.stringify({ v: 1, pairs: Object.fromEntries(pairs) });
    // Write through a temp name so a concurrent reader never sees a half file.
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, STATE_FILE);
  } catch {
    /* memory is best-effort */
  }
}

function statFor(kind: string, host: string): PairStat {
  const k = pairKey(kind, host);
  let s = pairs.get(k);
  if (!s) pairs.set(k, (s = { ok: 0, fail: 0, streak: 0, avgMs: 0, lastOkAt: 0, lastFailAt: 0 }));
  return s;
}

export function recordSolverOk(kind: string, host: string, ms: number): void {
  const s = statFor(kind, host);
  s.ok += 1;
  s.streak = 0;
  s.avgMs = s.ok === 1 ? ms : s.avgMs * 0.7 + ms * 0.3;
  s.lastOkAt = Date.now();
  scheduleWrite();
}

export function recordSolverFail(kind: string, host: string): void {
  const s = statFor(kind, host);
  s.fail += 1;
  s.streak += 1;
  s.lastFailAt = Date.now();
  scheduleWrite();
}

// Streak-and-recency ban: a solver only sits out while its last failure is
// still fresh, so it gets another chance once the site's instability passes.
export function isBenched(kind: string, host: string): boolean {
  const s = pairs.get(pairKey(kind, host));
  if (!s || s.streak < BENCH_AFTER) return false;
  return Date.now() - s.lastFailAt < BENCH_TTL_MS;
}

export function lastWinner(host: string): string | null {
  let best: string | null = null;
  let bestAt = 0;
  for (const [k, s] of pairs) {
    const { kind, host: h } = splitKey(k);
    if (h !== host || s.lastOkAt <= bestAt) continue;
    best = kind;
    bestAt = s.lastOkAt;
  }
  return best;
}

export function lastFailAt(kind: string, host: string): number {
  return pairs.get(pairKey(kind, host))?.lastFailAt ?? 0;
}

export function solverMemorySnapshot(): Record<string, PairStat> {
  return Object.fromEntries(pairs);
}
