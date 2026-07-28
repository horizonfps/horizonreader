// Disk tier for proxied images. Chapter pages are far too big to keep in RAM at
// any useful hit rate, but they never change, so a served page is downloaded
// from the scan source exactly once per host.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR =
  process.env.IMAGE_CACHE_DIR || (existsSync("/data") ? "/data/imgcache" : ".cache/images");
const MAX_BYTES = Number(process.env.IMAGE_CACHE_DISK_MB || 8_192) * 1024 * 1024;
const SWEEP_EVERY_MS = 10 * 60_000;

let ready: Promise<void> | null = null;
let lastSweep = 0;
let sweeping = false;

function ensureDir(): Promise<void> {
  if (!ready) ready = mkdir(DIR, { recursive: true }).then(() => {});
  return ready;
}

function pathFor(key: string, ext: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return join(DIR, `${h}${ext}`);
}

export async function getDiskImage(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    await ensureDir();
    const [body, ct] = await Promise.all([
      readFile(pathFor(key, ".bin")),
      readFile(pathFor(key, ".ct"), "utf8").catch(() => "application/octet-stream"),
    ]);
    if (!body.byteLength) return null;
    return { body, contentType: ct };
  } catch {
    return null;
  }
}

export async function setDiskImage(key: string, body: Uint8Array, contentType: string): Promise<void> {
  try {
    await ensureDir();
    const target = pathFor(key, ".bin");
    // Write through a temp name so a concurrent reader never sees a half file.
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
    await writeFile(pathFor(key, ".ct"), contentType);
  } catch {
    /* cache is best-effort */
  }
  void sweep();
}

// Age-based eviction, throttled so it never runs on a hot request path.
async function sweep(): Promise<void> {
  const now = Date.now();
  if (sweeping || now - lastSweep < SWEEP_EVERY_MS) return;
  sweeping = true;
  lastSweep = now;
  try {
    const names = await readdir(DIR);
    const files: { name: string; size: number; at: number }[] = [];
    let total = 0;
    for (const name of names) {
      if (!name.endsWith(".bin")) continue;
      const s = await stat(join(DIR, name)).catch(() => null);
      if (!s) continue;
      files.push({ name, size: s.size, at: s.mtimeMs });
      total += s.size;
    }
    if (total <= MAX_BYTES) return;
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (total <= MAX_BYTES * 0.9) break;
      await unlink(join(DIR, f.name)).catch(() => {});
      await unlink(join(DIR, f.name.replace(/\.bin$/, ".ct"))).catch(() => {});
      total -= f.size;
    }
  } catch {
    /* nothing to sweep */
  } finally {
    sweeping = false;
  }
}
