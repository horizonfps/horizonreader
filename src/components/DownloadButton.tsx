"use client";

import { useState } from "react";

export default function DownloadButton({
  chapterId,
  downloaded,
}: {
  chapterId: number;
  downloaded: boolean;
}) {
  const [state, setState] = useState<"idle" | "queued" | "done">(
    downloaded ? "done" : "idle",
  );
  const [loading, setLoading] = useState(false);

  async function download(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state !== "idle") return;
    setLoading(true);
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chapterId }),
    });
    if (res.ok) setState("queued");
    setLoading(false);
  }

  const label = state === "done" ? "Baixado" : state === "queued" ? "Na fila" : "Baixar";

  return (
    <button
      onClick={download}
      disabled={loading || state !== "idle"}
      className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-60"
      aria-label="Baixar capítulo"
    >
      {loading ? "…" : label}
    </button>
  );
}
