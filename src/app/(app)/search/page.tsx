"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, User as UserIcon, X, Clock } from "lucide-react";
import MangaCard from "@/components/MangaCard";
import Username from "@/components/Username";
import AdminBadge from "@/components/AdminBadge";
import { coverProxy, type Card } from "@/lib/cards";

type TopUser = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};

const RECENT_KEY = "search:recent";
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string): string[] {
  const next = [q, ...readRecent().filter((x) => x !== q)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [users, setUsers] = useState<TopUser[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    setRecent(readRecent());
    let alive = true;
    fetch("/api/users/top")
      .then((r) => r.json())
      .then((d: { users?: TopUser[] }) => {
        if (alive) setUsers(Array.isArray(d.users) ? d.users : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
          const list = Array.isArray(data.items) ? data.items : [];
          setItems(list);
          setSearched(true);
          setLoading(false);
          if (list.length) setRecent(pushRecent(q));
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setItems([]);
          setSearched(true);
          setLoading(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [query, router]);

  const trimmed = query.trim();
  const seen = new Set<string>();

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => e.preventDefault()} className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar obras"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
          className="h-12 w-full rounded-xl border border-border bg-surface pl-11 pr-10 text-base outline-none placeholder:text-muted focus:border-accent"
        />
        {query ? (
          <button
            type="button"
            aria-label="Limpar"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </form>

      {!trimmed && recent.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Buscas recentes</h2>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(RECENT_KEY);
                setRecent([]);
              }}
              className="text-xs text-muted hover:text-text"
            >
              Limpar
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setQuery(r)}
                className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs text-text hover:bg-elevated"
              >
                <Clock className="h-3 w-3 text-muted" />
                {r}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!trimmed && users.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text">Leitores</h2>
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
            {users.map((u) => {
              const src = coverProxy(u.avatarUrl);
              return (
                <Link
                  key={u.username}
                  href={`/u/${encodeURIComponent(u.username)}`}
                  className="flex w-16 shrink-0 flex-col items-center gap-1"
                >
                  <div className="h-14 w-14 overflow-hidden rounded-full border border-border bg-surface">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" draggable={false} className="cover-img h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted">
                        <UserIcon className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex max-w-full items-center gap-1">
                    <Username
                      name={u.displayName || u.username}
                      isAdmin={u.isAdmin}
                      className="truncate text-[11px] text-text"
                    />
                    {u.isAdmin ? <AdminBadge className="h-3.5 w-3.5" /> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {items.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text">
            {items.length} resultado{items.length === 1 ? "" : "s"}
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {items.map((item, i) => {
              const key = `${item.origin}:${item.externalId}`;
              if (seen.has(key)) return null;
              seen.add(key);
              return <MangaCard key={key} item={item} priority={i < 6} />;
            })}
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      ) : null}

      {!loading && items.length === 0 && trimmed && searched ? (
        <p className="py-16 text-center text-sm text-muted">Nenhuma obra encontrada.</p>
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
