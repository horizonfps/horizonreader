"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

export type SourceOption = {
  id: number;
  sourceName: string;
  chapterCount: number;
  healthScore: number;
  lang: string | null;
};

const LANG_ORDER: Record<string, number> = { "pt-br": 0, pt: 0, en: 1 };
const LANG_LABEL: Record<string, string> = { "pt-br": "Português", pt: "Português", en: "Inglês" };

export function langBadge(lang?: string | null): string {
  const l = (lang || "").toLowerCase();
  if (l === "pt-br" || l === "pt") return "PT";
  if (l === "en") return "EN";
  return l ? l.toUpperCase() : "?";
}

export function healthColor(score?: number | null): string {
  const v = score ?? 0;
  if (v >= 55) return "bg-green-500";
  if (v >= 30) return "bg-orange-400";
  return "bg-red-500";
}

function langRank(lang?: string | null): number {
  const l = (lang || "").toLowerCase();
  return LANG_ORDER[l] ?? 2;
}

export default function SourcePicker({
  sources,
  activeId,
  onSelect,
  onHover,
}: {
  sources: SourceOption[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onHover?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...sources]
      .filter((s) => !needle || s.sourceName.toLowerCase().includes(needle))
      .sort(
        (a, b) =>
          langRank(a.lang) - langRank(b.lang) ||
          b.healthScore - a.healthScore ||
          b.chapterCount - a.chapterCount,
      );
    const out: { label: string; items: SourceOption[] }[] = [];
    for (const s of sorted) {
      const l = (s.lang || "").toLowerCase();
      const label = LANG_LABEL[l] ?? (l ? l.toUpperCase() : "Outros");
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(s);
      else out.push({ label, items: [s] });
    }
    return out;
  }, [sources, q]);

  const active = sources.find((s) => s.id === activeId) ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-text hover:bg-elevated"
      >
        {active ? (
          <>
            <span className={`h-2 w-2 shrink-0 rounded-full ${healthColor(active.healthScore)}`} />
            <span className="truncate font-medium">{active.sourceName}</span>
            <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] leading-4 text-muted">
              {langBadge(active.lang)}
            </span>
            <span className="shrink-0 text-xs text-muted">{active.chapterCount} caps.</span>
          </>
        ) : (
          <span className="text-muted">Escolher fonte</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/60">
          {sources.length > 6 ? (
            <div className="relative border-b border-border">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filtrar fontes"
                className="h-9 w-full bg-transparent pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted"
              />
            </div>
          ) : null}
          <div role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
            {groups.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted">Nenhuma fonte.</p>
            ) : null}
            {groups.map((g) => (
              <div key={g.label}>
                <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {g.label} · {g.items.length}
                </p>
                {g.items.map((s) => {
                  const on = s.id === activeId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => {
                        setOpen(false);
                        onSelect(s.id);
                      }}
                      onPointerEnter={() => onHover?.(s.id)}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                        on ? "bg-accent/10 text-accent" : "text-text hover:bg-elevated"
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${healthColor(s.healthScore)}`} />
                      <span className="min-w-0 flex-1 truncate">{s.sourceName}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">{s.chapterCount}</span>
                      {on ? <Check className="h-4 w-4 shrink-0" /> : <span className="w-4" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
