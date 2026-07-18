"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

// Admin-only toggle pinning a work into the "Horizon Recomenda" home section.
export default function HorizonPickButton({
  workId,
  initialPicked,
}: {
  workId: number;
  initialPicked: boolean;
}) {
  const [picked, setPicked] = useState(initialPicked);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const prev = picked;
    setPicked(!prev);
    setBusy(true);
    try {
      const res = await fetch("/api/horizon-picks", {
        method: prev ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId }),
      });
      if (!res.ok) setPicked(prev);
    } catch {
      setPicked(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${
        picked
          ? "bg-accent text-on-accent hover:bg-accent-hover"
          : "border border-border bg-surface text-text hover:bg-elevated"
      }`}
    >
      <Sparkles className={`h-4 w-4 ${picked ? "fill-current" : ""}`} />
      {picked ? "No Horizon Recomenda" : "Horizon Recomenda"}
    </button>
  );
}
