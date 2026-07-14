"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/cards";

export default function FavoriteButton({
  workId,
  initialStatus,
}: {
  workId: number;
  initialStatus?: string | null;
}) {
  const [status, setStatus] = useState<string | null>(initialStatus ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function pick(next: string) {
    setOpen(false);
    if (busy) return;
    const prev = status;
    setStatus(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId, status: next }),
      });
      if (!res.ok) setStatus(prev);
    } catch {
      setStatus(prev);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setOpen(false);
    if (busy) return;
    const prev = status;
    setStatus(null); // optimistic
    setBusy(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workId }),
      });
      if (!res.ok) setStatus(prev);
    } catch {
      setStatus(prev);
    } finally {
      setBusy(false);
    }
  }

  const label = status ? STATUS_LABELS[status] ?? status : "Add to library";
  const filled = status != null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${
          filled
            ? "bg-accent text-on-accent hover:bg-accent-hover"
            : "border border-border bg-surface text-text hover:bg-elevated"
        }`}
      >
        <Bookmark className={`h-4 w-4 ${filled ? "fill-current" : ""}`} />
        {label}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-border bg-elevated py-1 shadow-lg"
        >
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              onClick={() => pick(s)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-text hover:bg-surface"
            >
              {STATUS_LABELS[s]}
              {status === s && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
          {status != null && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={remove}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-surface"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
