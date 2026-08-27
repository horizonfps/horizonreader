"use client";

import { useEffect, useState } from "react";
import { OFFLINE_CACHE, readOfflineIndex } from "@/lib/offlineProgress";

const KEY = "offline:autosave";

export default function OfflineAutoSaveToggle() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (typeof caches === "undefined") return;
    setSupported(true);
    try {
      setOn(localStorage.getItem(KEY) === "1");
    } catch {
      /* private mode keeps the switch off */
    }
    let alive = true;
    (async () => {
      try {
        const cache = await caches.open(OFFLINE_CACHE);
        const list = await readOfflineIndex(cache);
        if (alive) setCount(list.filter((item) => item?.chapterId !== undefined).length);
      } catch {
        /* an unreadable cache just shows zero */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!supported) return null;

  const toggle = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("hr:autosave-changed"));
  };

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        <span>Salvar no celular automaticamente</span>
      </label>
      <p className="text-xs text-muted">
        Vale só neste aparelho. Copia sozinho tudo que terminar de baixar no servidor.
      </p>
      <p className="text-xs text-muted">
        {count} {count === 1 ? "capítulo salvo" : "capítulos salvos"} neste aparelho
      </p>
    </div>
  );
}
