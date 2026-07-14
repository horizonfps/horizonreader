"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function RefreshLibraryButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function refresh() {
    setLoading(true);
    await fetch("/api/library/update", { method: "POST" });
    // Give Suwayomi a moment to pull new chapters, then reload the feed.
    timer.current = setTimeout(() => {
      router.refresh();
      setLoading(false);
    }, 2500);
  }

  return (
    <button
      onClick={refresh}
      disabled={loading}
      className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50"
    >
      {loading ? "Atualizando…" : "↻ Atualizar"}
    </button>
  );
}
