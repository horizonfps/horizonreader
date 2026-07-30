// Server-wide loop that periodically revalidates sources and chapter lists
// for favorited/recently-read works, ahead of the reader opening them.

import { prisma } from "@/lib/db";
import { queueSourceResolve, getPrimaryLink } from "@/lib/backbone/resolve";
import { refreshChapters } from "@/lib/chapterCache";

const raw = (process.env.FAVORITES_REFRESH || "").trim().toLowerCase();
const ENABLED = raw ? raw === "true" || raw === "1" : process.env.NODE_ENV === "production";

function numEnv(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const INTERVAL_MIN = numEnv("FAVORITES_REFRESH_INTERVAL_MIN", 30);
const MAX = numEnv("FAVORITES_REFRESH_MAX", 60);
const SPACING_MS = numEnv("FAVORITES_REFRESH_SPACING_MS", 5_000);

const FIRST_RUN_DELAY_MS = 2 * 60_000;
const HISTORY_WINDOW_MS = 7 * 86_400_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectWorkIds(): Promise<number[]> {
  const [favorites, history] = await Promise.all([
    prisma.favorite.findMany({
      select: { workId: true },
      orderBy: { updatedAt: "desc" },
      take: MAX,
    }),
    prisma.readingHistory.findMany({
      where: { readAt: { gt: new Date(Date.now() - HISTORY_WINDOW_MS) } },
      select: { workId: true },
      orderBy: { readAt: "desc" },
      take: MAX,
    }),
  ]);
  const ids = [...favorites.map((f) => f.workId), ...history.map((h) => h.workId)];
  return [...new Set(ids)].slice(0, MAX);
}

async function cycle(): Promise<void> {
  const started = Date.now();
  let count = 0;
  try {
    const workIds = await collectWorkIds();
    for (const workId of workIds) {
      try {
        queueSourceResolve(workId);
        const link = await getPrimaryLink(workId);
        if (link) await refreshChapters(link);
      } catch (e) {
        console.warn(`[favrefresh] work ${workId} failed`, e);
      }
      count += 1;
      await sleep(SPACING_MS);
    }
  } catch (e) {
    console.warn("[favrefresh] cycle failed", e);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[favrefresh] refreshed ${count} work(s) in ${seconds}s`);
}

function scheduleNext(delayMs: number): void {
  const t = setTimeout(() => {
    cycle().finally(() => scheduleNext(INTERVAL_MIN * 60_000));
  }, delayMs);
  (t as unknown as { unref?: () => void }).unref?.();
}

const globalForFavoritesRefresh = globalThis as unknown as { favoritesRefreshStarted?: boolean };

export function startFavoritesRefresh(): void {
  if (!ENABLED) return;
  if (globalForFavoritesRefresh.favoritesRefreshStarted) return;
  globalForFavoritesRefresh.favoritesRefreshStarted = true;
  scheduleNext(FIRST_RUN_DELAY_MS);
}
