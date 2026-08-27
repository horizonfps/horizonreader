// Reading progress made while offline, parked in the same Cache Storage the
// offline shelf uses and pushed to the server as soon as the network is back.

export const OFFLINE_CACHE = "hr-offline-v1";
export const OFFLINE_INDEX_URL = "/__offline/index.json";
export const PROGRESS_QUEUE_URL = "/__offline/progress.json";

export type PendingProgress = {
  chapterId: number;
  mangaId: number;
  workId: number | null;
  chapterNumber: number | null;
  lastPageRead: number;
  read: boolean;
  at: number;
};

export type OfflineItem = {
  chapterId: number;
  chapterName: string;
  workTitle?: string | null;
  workSlug?: string | null;
  mangaId?: number;
  workId?: number | null;
  chapterNumber?: number | null;
  urls: string[];
  savedAt: number;
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

async function readList<T>(cache: Cache, url: string): Promise<T[]> {
  try {
    const res = await cache.match(url);
    if (!res) return [];
    const list = await res.json();
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}

export async function readOfflineIndex(cache: Cache): Promise<OfflineItem[]> {
  return readList<OfflineItem>(cache, OFFLINE_INDEX_URL);
}

export async function writeOfflineIndex(cache: Cache, list: OfflineItem[]): Promise<void> {
  await cache.put(OFFLINE_INDEX_URL, jsonResponse(list));
}

async function readQueue(cache: Cache): Promise<PendingProgress[]> {
  return readList<PendingProgress>(cache, PROGRESS_QUEUE_URL);
}

async function writeQueue(cache: Cache, list: PendingProgress[]): Promise<void> {
  await cache.put(PROGRESS_QUEUE_URL, jsonResponse(list));
}

export async function queueProgress(entry: PendingProgress): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(OFFLINE_CACHE);
    const list = await readQueue(cache);
    const rest: PendingProgress[] = [];
    let previous: PendingProgress | null = null;
    for (const item of list) {
      if (item && item.chapterId === entry.chapterId && !previous) previous = item;
      else if (item) rest.push(item);
    }
    const keepsOld =
      previous !== null && !entry.read && entry.lastPageRead < (previous.lastPageRead ?? 0);
    rest.push(keepsOld ? (previous as PendingProgress) : entry);
    await writeQueue(cache, rest);
  } catch {
    /* a queue we cannot write is not worth breaking the reader over */
  }
}

export async function flushProgress(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;

  let cache: Cache;
  let list: PendingProgress[];
  try {
    cache = await caches.open(OFFLINE_CACHE);
    list = await readQueue(cache);
  } catch {
    return 0;
  }
  if (!list.length) return 0;

  let sent = 0;
  const left: PendingProgress[] = [];
  let stopped = false;

  for (const item of list) {
    if (stopped || !item || typeof item.chapterId !== "number") {
      if (item) left.push(item);
      continue;
    }
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mangaId: item.mangaId,
          chapterId: item.chapterId,
          workId: item.workId ?? null,
          chapterNumber: item.chapterNumber ?? null,
          lastPageRead: item.lastPageRead,
          read: item.read,
        }),
      });
      if (res.ok) sent += 1;
      else if (res.status !== 401) left.push(item);
    } catch {
      // Network is down again: keep this one and everything after it.
      stopped = true;
      left.push(item);
    }
  }

  try {
    await writeQueue(cache, left);
  } catch {
    /* ignore */
  }
  return sent;
}
