"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { coverProxy, workHref, type Card } from "@/lib/cards";
import { typeLabel, statusLabel } from "@/lib/labels";

const DEBOUNCE_MS = 250;
const MAX_ROWS = 8;

export default function GlobalSearch({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Card[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d: { items?: Card[] }) => {
          if (id !== reqId.current) return;
          setItems(Array.isArray(d.items) ? d.items.slice(0, MAX_ROWS) : []);
          setCursor(-1);
          setLoading(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setItems([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function goToResults() {
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(c + 1, items.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (cursor >= 0 && items[cursor]) {
        setOpen(false);
        router.push(workHref(items[cursor]));
        return;
      }
      goToResults();
    }
  }

  const trimmed = query.trim();
  const showPanel = open && trimmed.length >= 2;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar obras"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Buscar obras"
          className="h-9 w-full rounded-lg border border-border bg-bg pl-9 pr-8 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
        {query ? (
          <button
            type="button"
            aria-label="Limpar"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-muted sm:block">
            /
          </kbd>
        )}
      </div>

      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/60">
          {items.length > 0 ? (
            <ul className="max-h-[70vh] overflow-y-auto py-1">
              {items.map((item, i) => {
                const src = coverProxy(item.coverUrl);
                const meta = [typeLabel(item.type), statusLabel(item.status)].filter(Boolean).join(" · ");
                return (
                  <li key={`${item.origin}:${item.externalId}`}>
                    <a
                      href={workHref(item)}
                      onMouseEnter={() => setCursor(i)}
                      onClick={(e) => {
                        e.preventDefault();
                        setOpen(false);
                        router.push(workHref(item));
                      }}
                      className={`flex items-center gap-3 px-3 py-2 ${
                        i === cursor ? "bg-elevated" : "hover:bg-elevated"
                      }`}
                    >
                      <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-elevated">
                        {src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" className="cover-img h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text">{item.title}</p>
                        <p className="truncate text-xs text-muted">
                          {meta}
                          {item.rating != null ? ` · ★ ${item.rating.toFixed(1)}` : ""}
                        </p>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-4 text-sm text-muted">
              {loading ? "Buscando…" : "Nenhuma obra encontrada."}
            </p>
          )}
          <button
            type="button"
            onClick={goToResults}
            className="flex w-full items-center justify-between border-t border-border px-3 py-2 text-xs text-muted hover:bg-elevated hover:text-text"
          >
            <span>Ver todos os resultados para “{trimmed}”</span>
            <span>↵</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
