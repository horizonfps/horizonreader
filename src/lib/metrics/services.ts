// Application-level health: the engine, the challenge solvers, the tunnel, the
// database and the on-disk caches.

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { listExtensions, listSources } from "@/lib/suwayomi";
import { findHostProcess } from "./host";

export type Probe = {
  name: string;
  url: string | null;
  ok: boolean;
  latencyMs: number | null;
  detail: string | null;
  error: string | null;
};

const SUWAYOMI_URL = process.env.SUWAYOMI_URL || "http://localhost:4567";
const IMAGE_CACHE_DIR =
  process.env.IMAGE_CACHE_DIR || (existsSync("/data") ? "/data/imgcache" : ".cache/images");
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || "/suwayomi/downloads";

// Directory walks and the extension catalogue are far too slow for the poll
// interval, so they are served from a short-lived memo.
const memo = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function timed(fn: () => Promise<string | null>): Promise<Omit<Probe, "name" | "url">> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - started, detail, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: null,
      error: (err as Error).message.slice(0, 200),
    };
  }
}

async function getJson(url: string, timeoutMs = 6_000): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// ---- engine ----

async function suwayomiProbe(): Promise<Probe & { extensions: ExtensionStats | null; sources: number | null }> {
  const result = await timed(async () => {
    const res = await fetch(`${SUWAYOMI_URL}/api/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ aboutServer { name version revision buildType } }" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { aboutServer?: Record<string, string> } };
    const about = json.data?.aboutServer;
    return about ? `${about.name} ${about.version} (${about.revision})` : "online";
  });

  const catalogue = result.ok ? await cached("catalogue", 120_000, loadCatalogue) : null;

  return {
    name: "Suwayomi",
    url: SUWAYOMI_URL,
    ...result,
    extensions: catalogue?.extensions ?? null,
    sources: catalogue?.sources ?? null,
  };
}

type ExtensionStats = {
  installed: number;
  obsolete: number;
  updatable: number;
  available: number;
  byLang: { lang: string; count: number }[];
};

async function loadCatalogue(): Promise<{ extensions: ExtensionStats; sources: number } | null> {
  try {
    const [extensions, sources] = await Promise.all([listExtensions(), listSources()]);
    const installed = extensions.filter((e) => e.isInstalled);
    const byLang = new Map<string, number>();
    for (const ext of installed) byLang.set(ext.lang, (byLang.get(ext.lang) || 0) + 1);
    return {
      extensions: {
        installed: installed.length,
        obsolete: installed.filter((e) => e.isObsolete).length,
        updatable: installed.filter((e) => e.hasUpdate).length,
        available: extensions.length,
        byLang: [...byLang.entries()]
          .map(([lang, count]) => ({ lang, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      },
      sources: sources.length,
    };
  } catch {
    return null;
  }
}

// ---- challenge solvers ----

function solverTargets(): { name: string; url: string }[] {
  const raw = process.env.SOLVERS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const at = entry.indexOf("@");
        return at === -1
          ? { name: new URL(entry).hostname, url: entry }
          : { name: entry.slice(0, at), url: entry.slice(at + 1) };
      });
  }
  const legacy = process.env.FLARESOLVERR_URL;
  return legacy ? [{ name: process.env.SOLVER_KIND || "flaresolverr", url: legacy }] : [];
}

async function solverProbes(): Promise<Probe[]> {
  return Promise.all(
    solverTargets().map(async ({ name, url }) => {
      const base = url.replace(/\/+$/, "");
      const result = await timed(async () => {
        const health = await fetch(`${base}/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(6_000),
        }).catch(() => null);
        if (health?.ok) {
          const body = (await health.json().catch(() => ({}))) as Record<string, unknown>;
          return String(body.version || body.status || "healthy");
        }
        const root = (await getJson(base)) as Record<string, unknown>;
        if (root.version) return `v${root.version}`;
        if (root.msg) return String(root.msg);
        throw new Error(health ? `HTTP ${health.status}` : "sem resposta");
      });
      return { name, url: base, ...result };
    }),
  );
}

// ---- tunnel ----

async function tunnelProbe(): Promise<Probe & { pid: number | null }> {
  const connector = await findHostProcess("cloudflared");
  return {
    name: "Cloudflare Tunnel",
    url: null,
    ok: Boolean(connector),
    latencyMs: null,
    detail: connector ? `pid ${connector.pid}` : null,
    error: connector ? null : "conector cloudflared não encontrado no host",
    pid: connector?.pid ?? null,
  };
}

// ---- storage ----

async function dirStats(dir: string, maxEntries = 40_000) {
  if (!existsSync(dir)) return { exists: false, files: 0, bytes: 0, truncated: false };
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files >= maxEntries) {
        truncated = true;
        break;
      }
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      files += 1;
      bytes += info.size;
    }
    if (truncated) break;
  }
  return { exists: true, files, bytes, truncated };
}

function databasePath(): string | null {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) return null;
  const path = url.slice(5);
  return path.startsWith("/") ? path : join(process.cwd(), "prisma", path);
}

async function storageStats() {
  const dbPath = databasePath();
  const [db, wal, cache, downloads] = await Promise.all([
    dbPath ? stat(dbPath).catch(() => null) : null,
    dbPath ? stat(`${dbPath}-wal`).catch(() => null) : null,
    cached("imgcache", 60_000, () => dirStats(IMAGE_CACHE_DIR)),
    cached("downloads", 300_000, () => dirStats(DOWNLOADS_DIR)),
  ]);

  return {
    database: { path: dbPath, bytes: (db?.size ?? 0) + (wal?.size ?? 0), exists: Boolean(db) },
    imageCache: {
      ...cache,
      dir: IMAGE_CACHE_DIR,
      budgetBytes: Number(process.env.IMAGE_CACHE_DISK_MB || 8_192) * 1024 * 1024,
      memBudgetBytes: Number(process.env.IMAGE_CACHE_MEM_MB || 512) * 1024 * 1024,
    },
    downloads: { ...downloads, dir: DOWNLOADS_DIR },
  };
}

// ---- database content ----

async function databaseStats() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [users, works, links, scraped, favorites, progress, history, picks, readers24h, chapters24h] =
    await Promise.all([
      prisma.user.count(),
      prisma.work.count(),
      prisma.sourceLink.count(),
      prisma.scrapedChapter.count(),
      prisma.favorite.count(),
      prisma.progress.count(),
      prisma.readingHistory.count(),
      prisma.horizonPick.count(),
      prisma.readingHistory.findMany({
        where: { readAt: { gte: dayAgo } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.readingHistory.count({ where: { readAt: { gte: dayAgo } } }),
    ]);

  const recent = await prisma.readingHistory.findFirst({
    orderBy: { readAt: "desc" },
    select: { readAt: true },
  });
  const chapters7d = await prisma.readingHistory.count({ where: { readAt: { gte: weekAgo } } });

  return {
    users,
    works,
    sourceLinks: links,
    scrapedChapters: scraped,
    favorites,
    progress,
    history,
    horizonPicks: picks,
    activeReaders24h: readers24h.length,
    chaptersRead24h: chapters24h,
    chaptersRead7d: chapters7d,
    lastReadAt: recent?.readAt?.toISOString() ?? null,
  };
}

export type ServicesSnapshot = Awaited<ReturnType<typeof readServices>>;

export async function readServices() {
  const [suwayomi, solvers, tunnel, storage, database] = await Promise.all([
    suwayomiProbe(),
    solverProbes(),
    tunnelProbe(),
    storageStats(),
    databaseStats().catch(() => null),
  ]);

  return {
    suwayomi,
    solvers,
    tunnel,
    storage,
    database,
    app: {
      node: process.version,
      env: process.env.NODE_ENV || "development",
      uptimeSeconds: process.uptime(),
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
      timezone: process.env.TZ || null,
    },
  };
}
