// Application-level health: the engine, the challenge solvers, the tunnel, the
// database and the on-disk caches.

import { existsSync } from "node:fs";
import { readdir, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prisma } from "@/lib/db";
import { tierDir } from "@/lib/diskCache";
import { solverMemorySnapshot } from "@/lib/scrapers/solverMemory";
import { engineGateSnapshot } from "@/lib/backbone/engineGate";
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

// Liveness comes from REST and saturation from GraphQL, because they fail
// independently: a search backlog parks every GraphQL worker while the process
// still answers REST in milliseconds, and reading liveness off GraphQL reported
// that as a dead engine.
async function suwayomiProbe(): Promise<
  Probe & { extensions: ExtensionStats | null; sources: number | null; graphql: GraphqlHealth }
> {
  const result = await timed(async () => {
    const res = await fetch(`${SUWAYOMI_URL}/api/v1/settings/about`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const about = (await res.json().catch(() => ({}))) as Record<string, string>;
    return about.version ? `${about.name} ${about.version} (${about.revision})` : "online";
  });

  const graphql = result.ok ? await graphqlHealth() : { ok: false, latencyMs: null, error: null };
  const catalogue = graphql.ok ? await cached("catalogue", 120_000, loadCatalogue) : null;

  return {
    name: "Suwayomi",
    url: SUWAYOMI_URL,
    ...result,
    detail: graphql.ok
      ? result.detail
      : [result.detail, "GraphQL saturado"].filter(Boolean).join(" · "),
    extensions: catalogue?.extensions ?? null,
    sources: catalogue?.sources ?? null,
    graphql: { ...graphql, gate: engineGateSnapshot() },
  };
}

type GraphqlProbe = { ok: boolean; latencyMs: number | null; error: string | null };
type GraphqlHealth = GraphqlProbe & { gate: ReturnType<typeof engineGateSnapshot> };

async function graphqlHealth(): Promise<GraphqlProbe> {
  const started = Date.now();
  try {
    const res = await fetch(`${SUWAYOMI_URL}/api/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ aboutServer { version } }" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json().catch(() => ({}));
    return { ok: true, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: (err as Error).message.slice(0, 200),
    };
  }
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
        // Byparr answers /health by driving a real browser through a full solve
        // against an external site, so opening this panel would cost a browser
        // boot and seconds of waiting. Its docs route is static.
        if (name === "byparr") {
          const res = await fetch(`${base}/docs`, {
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          }).catch(() => null);
          if (res?.ok) return "online";
          throw new Error(res ? `HTTP ${res.status}` : "sem resposta");
        }
        // trawl reports its browser pool instead of a version, and that
        // occupancy is what says whether a solve would queue.
        if (name === "trawl") {
          const res = await fetch(`${base}/health`, {
            cache: "no-store",
            signal: AbortSignal.timeout(5_000),
          }).catch(() => null);
          if (!res?.ok) throw new Error(res ? `HTTP ${res.status}` : "sem resposta");
          const body = (await res.json().catch(() => ({}))) as {
            status?: unknown;
            pool?: { total?: unknown; available?: unknown; restarts?: unknown };
          };
          const pool = body.pool ?? {};
          const parts: string[] = [];
          if (typeof pool.available === "number" && typeof pool.total === "number") {
            parts.push(`pool ${pool.available}/${pool.total} livre`);
          }
          if (typeof pool.restarts === "number" && pool.restarts > 0) {
            parts.push(`${pool.restarts} reinícios`);
          }
          return parts.length ? parts.join(" · ") : String(body.status || "healthy");
        }
        const health = await fetch(`${base}/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        if (health?.ok) {
          const body = (await health.json().catch(() => ({}))) as Record<string, unknown>;
          const version = typeof body.version === "string" ? body.version.slice(0, 12) : null;
          return version || String(body.status || body.msg || "healthy");
        }
        const root = (await getJson(base, 8_000)) as Record<string, unknown>;
        if (root.version) return `v${root.version}`;
        if (root.msg) return String(root.msg);
        throw new Error(health ? `HTTP ${health.status}` : "sem resposta");
      });
      return { name, url: base, ...result };
    }),
  );
}

// Reads the per-(engine, host) scoreboard the solver gateway keeps on disk, so
// the panel can answer which engine clears which site without an SSH session.
// Pure map arithmetic: the panel refreshes every 30s.
function solverEngineStats() {
  const snapshot = solverMemorySnapshot();
  const configured = solverTargets().map((t) => t.name);
  const perHost = new Map<string, { winner: string | null; at: number; touches: number }>();
  const perKind = new Map<
    string,
    { ok: number; fail: number; msWeight: number; hosts: { host: string; ok: number; fail: number }[] }
  >();
  for (const name of configured) {
    perKind.set(name, { ok: 0, fail: 0, msWeight: 0, hosts: [] });
  }

  for (const [key, stat] of Object.entries(snapshot)) {
    const i = key.indexOf("|");
    if (i < 0) continue;
    const kind = key.slice(0, i);
    const host = key.slice(i + 1);

    const agg = perKind.get(kind);
    if (agg) {
      agg.ok += stat.ok;
      agg.fail += stat.fail;
      agg.msWeight += stat.avgMs * stat.ok;
      if (stat.fail > 0) agg.hosts.push({ host, ok: stat.ok, fail: stat.fail });
    }

    const seen = perHost.get(host) ?? { winner: null, at: 0, touches: 0 };
    seen.touches += stat.ok + stat.fail;
    if (stat.lastOkAt > seen.at) {
      seen.winner = kind;
      seen.at = stat.lastOkAt;
    }
    perHost.set(host, seen);
  }

  const engines = configured.map((kind) => {
    const agg = perKind.get(kind)!;
    const total = agg.ok + agg.fail;
    return {
      kind,
      ok: agg.ok,
      fail: agg.fail,
      successRate: total ? (agg.ok / total) * 100 : null,
      avgMs: agg.ok ? Math.round(agg.msWeight / agg.ok) : null,
      worstHosts: agg.hosts.sort((a, b) => b.fail - a.fail).slice(0, 5),
    };
  });

  const hosts = [...perHost.entries()]
    .sort((a, b) => b[1].touches - a[1].touches)
    .slice(0, 10)
    .map(([host, v]) => ({ host, winner: v.winner }));

  return { engines, hosts };
}

// ---- tunnel ----

// The public entrypoint lives on the host, not in the compose stack: it is
// either a tunnel connector or a reverse proxy, depending on the deploy.
const FRONTS: Record<string, string> = {
  cloudflared: "Cloudflare Tunnel",
  nginx: "nginx",
  caddy: "Caddy",
  traefik: "Traefik",
};

async function frontProbe(): Promise<Probe & { pid: number | null }> {
  const found = await findHostProcess(Object.keys(FRONTS));
  return {
    name: "Entrada pública",
    url: null,
    ok: Boolean(found),
    latencyMs: null,
    detail: found ? `${FRONTS[found.name]} · pid ${found.pid}` : null,
    error: found ? null : "nenhum proxy ou túnel encontrado no host",
    pid: found?.pid ?? null,
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

// statfs needs a path that exists, and the download folder is only created on
// the first download, so probe the nearest existing ancestor.
async function diskSpace(dir: string): Promise<{ diskTotal: number; diskFree: number }> {
  let probe = dir;
  for (let depth = 0; depth < 8 && !existsSync(probe); depth += 1) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const fs = await statfs(probe).catch(() => null);
  if (!fs) return { diskTotal: 0, diskFree: 0 };
  return {
    diskTotal: Number(fs.blocks) * Number(fs.bsize),
    diskFree: Number(fs.bavail) * Number(fs.bsize),
  };
}

async function appDownloadStats() {
  const dir = tierDir("download");
  const [disk, folder, done, queued, running, failed, stored] = await Promise.all([
    diskSpace(dir),
    cached("appdownloads", 60_000, () => dirStats(dir)),
    prisma.chapterDownload.count({ where: { status: "DONE" } }).catch(() => 0),
    prisma.chapterDownload.count({ where: { status: "QUEUED" } }).catch(() => 0),
    prisma.chapterDownload.count({ where: { status: "RUNNING" } }).catch(() => 0),
    prisma.chapterDownload.count({ where: { status: "ERROR" } }).catch(() => 0),
    prisma.chapterDownload
      .aggregate({ _sum: { bytes: true } })
      .then((r) => r._sum.bytes ?? 0)
      .catch(() => 0),
  ]);

  return {
    dir,
    exists: folder.exists,
    files: folder.files,
    bytes: folder.bytes,
    done,
    queued,
    running,
    failed,
    storedBytes: stored,
    diskTotal: disk.diskTotal,
    diskFree: disk.diskFree,
  };
}

function databasePath(): string | null {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) return null;
  const path = url.slice(5);
  return path.startsWith("/") ? path : join(process.cwd(), "prisma", path);
}

async function storageStats() {
  const dbPath = databasePath();
  const [db, wal, cache, downloads, appDownloads] = await Promise.all([
    dbPath ? stat(dbPath).catch(() => null) : null,
    dbPath ? stat(`${dbPath}-wal`).catch(() => null) : null,
    cached("imgcache", 60_000, () => dirStats(IMAGE_CACHE_DIR)),
    cached("downloads", 300_000, () => dirStats(DOWNLOADS_DIR)),
    appDownloadStats(),
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
    appDownloads,
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
  const [suwayomi, solvers, front, storage, database] = await Promise.all([
    suwayomiProbe(),
    solverProbes(),
    frontProbe(),
    storageStats(),
    databaseStats().catch(() => null),
  ]);

  return {
    suwayomi,
    solvers,
    solverEngines: solverEngineStats(),
    front,
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
