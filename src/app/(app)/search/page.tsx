"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import MangaCard from "@/components/MangaCard";
import type { Card } from "@/lib/cards";

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const reqId = useRef(0);

  // Debounced search + URL sync; stale responses are dropped via reqId.
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => {
      router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false });

      if (!q) {
        setItems([]);
        setSearched(false);
        setLoading(false);
        return;
      }

      const id = ++reqId.current;
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: { items?: Card[] }) => {
          if (id !== reqId.current) return;
          setItems(Array.isArray(data.items) ? data.items : []);
          setSearched(true);
          setLoading(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setItems([]);
          setSearched(true);
          setLoading(false);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [query, router]);

  const trimmed = query.trim();
  const seen = new Set<string>();

  return (
    <div className="min-h-dvh bg-bg">
      <form onSubmit={(e) => e.preventDefault()} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar mangás…"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
      </form>

      {items.length > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {items.map((item) => {
            const key = `${item.origin}:${item.externalId}`;
            if (seen.has(key)) return null;
            seen.add(key);
            return <MangaCard key={key} item={item} />;
          })}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          {trimmed ? (searched ? "Sem resultados." : "") : "Digite para buscar mangás."}
        </p>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}
