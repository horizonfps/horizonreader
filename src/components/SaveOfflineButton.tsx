"use client";

import { useCallback, useEffect, useState } from "react";

const OFFLINE_CACHE = "hr-offline-v1";
const INDEX_URL = "/__offline/index.json";

type OfflineItem = {
  chapterId: number;
  chapterName: string;
  workTitle?: string | null;
  workSlug?: string | null;
  urls: string[];
  savedAt: number;
};

type Props = {
  chapterId: number;
  chapterName: string;
  workTitle?: string | null;
  workSlug?: string | null;
  urls: string[];
};

type State = "idle" | "saving" | "saved" | "failed";

async function readIndex(cache: Cache): Promise<OfflineItem[]> {
  try {
    const res = await cache.match(INDEX_URL);
    if (!res) return [];
    const list = await res.json();
    return Array.isArray(list) ? (list as OfflineItem[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(cache: Cache, list: OfflineItem[]): Promise<void> {
  await cache.put(
    INDEX_URL,
    new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }),
  );
}

export default function SaveOfflineButton({
  chapterId,
  chapterName,
  workTitle,
  workSlug,
  urls,
}: Props) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (typeof caches === "undefined") return;
    setSupported(true);
    let alive = true;
    (async () => {
      try {
        const cache = await caches.open(OFFLINE_CACHE);
        const list = await readIndex(cache);
        if (alive && list.some((item) => item?.chapterId === chapterId)) setState("saved");
      } catch {
        /* an unreadable cache just leaves the button offering to save */
      }
    })();
    return () => {
      alive = false;
    };
  }, [chapterId]);

  const save = useCallback(async () => {
    if (state === "saving" || state === "saved" || !urls.length) return;
    setState("saving");
    setDone(0);

    let stored = 0;
    let cache: Cache;
    try {
      cache = await caches.open(OFFLINE_CACHE);
    } catch {
      setState("failed");
      return;
    }

    for (let i = 0; i < urls.length; i++) {
      try {
        await cache.add(urls[i]);
        stored += 1;
      } catch {
        /* a dropped page must not abort the whole chapter */
      }
      setDone(i + 1);
    }

    if (!stored) {
      setState("failed");
      return;
    }

    try {
      const list = await readIndex(cache);
      const rest = list.filter((item) => item?.chapterId !== chapterId);
      rest.push({ chapterId, chapterName, workTitle, workSlug, urls, savedAt: Date.now() });
      await writeIndex(cache, rest);
    } catch {
      setState("failed");
      return;
    }

    setState("saved");
  }, [state, urls, chapterId, chapterName, workTitle, workSlug]);

  if (!supported) return null;

  const label =
    state === "saving"
      ? `Salvando ${done}/${urls.length}`
      : state === "saved"
        ? "Salvo no celular"
        : state === "failed"
          ? "Falhou · tentar de novo"
          : "Salvar no celular";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        save();
      }}
      disabled={state === "saved" || state === "saving"}
      className="shrink-0 whitespace-nowrap text-xs text-white disabled:opacity-60"
    >
      {label}
    </button>
  );
}
