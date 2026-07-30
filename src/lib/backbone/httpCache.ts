// Disk+memory cache for MangaDex/Comick JSON responses. A stale entry is
// served immediately while a background refresh keeps it warm, so a restart
// or a source outage never comes back to an empty list.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR =
  process.env.BACKBONE_CACHE_DIR || (existsSync("/data") ? "/data/jsoncache" : ".cache/json");
const MAX_MEM_ENTRIES = 500;
// A single MangaDex listing runs to hundreds of KB, so entry count alone lets
// the map grow past the whole process budget. Bytes are the real ceiling.
const MAX_MEM_BYTES = Number(process.env.BACKBONE_CACHE_MEM_MB || 96) * 1024 * 1024;
const MAX_AGE_MS = 30 * 86_400_000;
const MAX_FILES = 20_000;
const SWEEP_EVERY_MS = 10 * 60_000;

type Entry = { data: unknown; at: number; bytes: number };
type DiskShape = { v: 1; at: number; data: unknown };

const mem = new Map<string, Entry>();
let memBytes = 0;
// Dedupes concurrent loads (first fetch or background revalidation) per key.
const inFlight = new Map<string, Promise<unknown>>();

let ready: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!ready) ready = mkdir(DIR, { recursive: true }).then(() => {});
  return ready;
}

function pathFor(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return join(DIR, `${h}.json`);
}

// Rough payload weight, charged as UTF-16 so the estimate never undershoots.
function weigh(data: unknown): number {
  try {
    return JSON.stringify(data).length * 2;
  } catch {
    return 0;
  }
}

function rememberMem(key: string, data: unknown, at: number): void {
  const prev = mem.get(key);
  if (prev) {
    mem.delete(key);
    memBytes -= prev.bytes;
  }
  const bytes = weigh(data);
  mem.set(key, { data, at, bytes });
  memBytes += bytes;
  while (mem.size > MAX_MEM_ENTRIES || (memBytes > MAX_MEM_BYTES && mem.size > 1)) {
    const oldest = mem.keys().next().value!;
    memBytes -= mem.get(oldest)!.bytes;
    mem.delete(oldest);
  }
}

async function readDisk(key: string): Promise<Entry | null> {
  try {
    await ensureDir();
    const raw = JSON.parse(await readFile(pathFor(key), "utf8")) as Partial<DiskShape>;
    if (raw.v !== 1 || typeof raw.at !== "number") return null;
    if (Date.now() - raw.at > MAX_AGE_MS) return null;
    return { data: raw.data, at: raw.at, bytes: weigh(raw.data) };
  } catch {
    return null;
  }
}

async function writeDisk(key: string, data: unknown, at: number): Promise<void> {
  try {
    await ensureDir();
    const target = pathFor(key);
    // Write through a temp name so a concurrent reader never sees a half file.
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ v: 1, at, data } satisfies DiskShape));
    await rename(tmp, target);
  } catch {
    /* cache is best-effort */
  }
  void sweep();
}

let lastSweep = 0;
let sweeping = false;

// Age/count eviction, throttled so it never runs on a hot request path.
async function sweep(): Promise<void> {
  const now = Date.now();
  if (sweeping || now - lastSweep < SWEEP_EVERY_MS) return;
  sweeping = true;
  lastSweep = now;
  try {
    const names = await readdir(DIR);
    const files: { name: string; at: number }[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const s = await stat(join(DIR, name)).catch(() => null);
      if (!s) continue;
      files.push({ name, at: s.mtimeMs });
    }
    const cutoff = now - MAX_AGE_MS;
    const kept: { name: string; at: number }[] = [];
    for (const f of files) {
      if (f.at < cutoff) await unlink(join(DIR, f.name)).catch(() => {});
      else kept.push(f);
    }
    if (kept.length > MAX_FILES) {
      kept.sort((a, b) => a.at - b.at);
      for (let i = 0; i < kept.length - MAX_FILES; i++) {
        await unlink(join(DIR, kept[i].name)).catch(() => {});
      }
    }
  } catch {
    /* nothing to sweep */
  } finally {
    sweeping = false;
  }
}

// Fetches and stores `load()`'s result, deduped per key. A null/undefined
// result is never stored; the caller falls back to whatever it already has.
function loadAndStore<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T | null>;
  const p = load()
    .catch(() => null)
    .then((data) => {
      if (data === null || data === undefined) return null;
      const at = Date.now();
      rememberMem(key, data, at);
      void writeDisk(key, data, at);
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T | null>,
): Promise<T | null> {
  let entry = mem.get(key);
  if (!entry) {
    const disk = await readDisk(key);
    if (disk) {
      entry = disk;
      rememberMem(key, disk.data, disk.at);
    }
  }

  if (entry && Date.now() - entry.at < ttlMs) return entry.data as T;

  if (entry) {
    // Stale: serve it now, refresh in the background.
    void loadAndStore(key, load);
    return entry.data as T;
  }

  // No entry anywhere: the caller has to wait for the first load.
  const fresh = await loadAndStore(key, load);
  return (fresh as T | null) ?? null;
}
