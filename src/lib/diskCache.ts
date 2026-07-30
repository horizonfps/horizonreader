// Disk tier for proxied images, split in two independent tiers so one never
// evicts the other. Chapter pages are far too big to keep in RAM at any
// useful hit rate and never change, so a served page is downloaded from the
// scan source exactly once per host. Covers get their own folder/ceiling and
// a 7-day validity, since a source can swap a cover.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Tier = "page" | "cover";

const COVER_MAX_AGE_MS = 7 * 86_400_000;

const TIERS: Record<Tier, { dir: string; maxBytes: number; maxAgeMs: number | null }> = {
  page: {
    dir: process.env.IMAGE_CACHE_DIR || (existsSync("/data") ? "/data/imgcache" : ".cache/images"),
    maxBytes: Number(process.env.IMAGE_CACHE_DISK_MB || 8_192) * 1024 * 1024,
    maxAgeMs: null,
  },
  cover: {
    dir: process.env.COVER_CACHE_DIR || (existsSync("/data") ? "/data/covercache" : ".cache/covers"),
    maxBytes: Number(process.env.COVER_CACHE_DISK_MB || 1_024) * 1024 * 1024,
    maxAgeMs: COVER_MAX_AGE_MS,
  },
};

const SWEEP_EVERY_MS = 10 * 60_000;

const readyByTier = new Map<Tier, Promise<void>>();
const lastSweepByTier = new Map<Tier, number>();
const sweepingByTier = new Set<Tier>();

function ensureDir(tier: Tier): Promise<void> {
  let p = readyByTier.get(tier);
  if (!p) {
    p = mkdir(TIERS[tier].dir, { recursive: true }).then(() => {});
    readyByTier.set(tier, p);
  }
  return p;
}

function pathFor(tier: Tier, key: string, ext: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return join(TIERS[tier].dir, `${h}${ext}`);
}

export async function getDiskImage(
  key: string,
  tier: Tier,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    await ensureDir(tier);
    const target = pathFor(tier, key, ".bin");
    const maxAgeMs = TIERS[tier].maxAgeMs;
    if (maxAgeMs !== null) {
      const s = await stat(target);
      if (Date.now() - s.mtimeMs > maxAgeMs) return null;
    }
    const [body, ct] = await Promise.all([
      readFile(target),
      readFile(pathFor(tier, key, ".ct"), "utf8").catch(() => "application/octet-stream"),
    ]);
    if (!body.byteLength) return null;
    return { body, contentType: ct };
  } catch {
    return null;
  }
}

export async function setDiskImage(
  key: string,
  body: Uint8Array,
  contentType: string,
  tier: Tier,
): Promise<void> {
  try {
    await ensureDir(tier);
    const target = pathFor(tier, key, ".bin");
    // Write through a temp name so a concurrent reader never sees a half file.
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
    await writeFile(pathFor(tier, key, ".ct"), contentType);
  } catch {
    /* cache is best-effort */
  }
  void sweep(tier);
}

// Age/size-based eviction, throttled so it never runs on a hot request path.
async function sweep(tier: Tier): Promise<void> {
  const now = Date.now();
  if (sweepingByTier.has(tier) || now - (lastSweepByTier.get(tier) ?? 0) < SWEEP_EVERY_MS) return;
  sweepingByTier.add(tier);
  lastSweepByTier.set(tier, now);
  try {
    const { dir, maxBytes } = TIERS[tier];
    const names = await readdir(dir);
    const files: { name: string; size: number; at: number }[] = [];
    let total = 0;
    for (const name of names) {
      if (!name.endsWith(".bin")) continue;
      const s = await stat(join(dir, name)).catch(() => null);
      if (!s) continue;
      files.push({ name, size: s.size, at: s.mtimeMs });
      total += s.size;
    }
    if (total <= maxBytes) return;
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (total <= maxBytes * 0.9) break;
      await unlink(join(dir, f.name)).catch(() => {});
      await unlink(join(dir, f.name.replace(/\.bin$/, ".ct"))).catch(() => {});
      total -= f.size;
    }
  } catch {
    /* nothing to sweep */
  } finally {
    sweepingByTier.delete(tier);
  }
}
