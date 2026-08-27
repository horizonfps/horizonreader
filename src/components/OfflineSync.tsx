"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  OFFLINE_CACHE,
  flushProgress,
  readOfflineIndex,
  writeOfflineIndex,
  type OfflineItem,
} from "@/lib/offlineProgress";

const TICK_MS = 60_000;
// Chapters copied per pass, so a big backlog doesn't hog the connection.
const PER_PASS = 3;

type DownloadRow = {
  chapterId: number;
  status: string;
};

type PagesResponse = {
  chapterId: number;
  chapterName: string;
  workTitle?: string | null;
  workSlug?: string | null;
  mangaId?: number;
  workId?: number | null;
  chapterNumber?: number | null;
  urls?: string[];
};

export default function OfflineSync() {
  const running = useRef(false);

  const autoSave = useCallback(async () => {
    if (running.current) return;
    if (typeof caches === "undefined") return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      if (localStorage.getItem("offline:autosave") !== "1") return;
    } catch {
      return;
    }

    running.current = true;
    try {
      const res = await fetch("/api/download", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: DownloadRow[] };
      const items = Array.isArray(data?.items) ? data.items : [];

      const cache = await caches.open(OFFLINE_CACHE);
      const index = await readOfflineIndex(cache);
      const saved = new Set(index.map((item) => item?.chapterId));
      const pending = items
        .filter((item) => item && item.status === "DONE" && !saved.has(item.chapterId))
        .slice(0, PER_PASS);
      if (!pending.length) return;

      for (const row of pending) {
        let info: PagesResponse | null = null;
        try {
          const r = await fetch(`/api/download/pages?chapterId=${row.chapterId}`, {
            credentials: "same-origin",
          });
          if (r.ok) info = (await r.json()) as PagesResponse;
        } catch {
          info = null;
        }
        const urls = info && Array.isArray(info.urls) ? info.urls : [];
        if (!urls.length) continue;

        let stored = 0;
        for (const url of urls) {
          try {
            await cache.add(url);
            stored += 1;
          } catch {
            /* a dropped page must not lose the chapter */
          }
        }
        if (!stored || !info) continue;

        const entry: OfflineItem = {
          chapterId: info.chapterId,
          chapterName: info.chapterName,
          workTitle: info.workTitle,
          workSlug: info.workSlug,
          mangaId: info.mangaId,
          workId: info.workId ?? null,
          chapterNumber: info.chapterNumber ?? null,
          urls,
          savedAt: Date.now(),
        };
        const list = await readOfflineIndex(cache);
        const rest = list.filter((item) => item?.chapterId !== entry.chapterId);
        rest.push(entry);
        await writeOfflineIndex(cache, rest);
      }
    } catch {
      /* the next pass tries again */
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void flushProgress();
    void autoSave();

    const onOnline = () => {
      void flushProgress();
      void autoSave();
    };
    const onToggle = () => void autoSave();
    window.addEventListener("online", onOnline);
    window.addEventListener("hr:autosave-changed", onToggle);

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void flushProgress();
      void autoSave();
    }, TICK_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("hr:autosave-changed", onToggle);
      clearInterval(timer);
    };
  }, [autoSave]);

  return null;
}
