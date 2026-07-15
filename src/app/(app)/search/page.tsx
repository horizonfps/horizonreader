"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, User as UserIcon } from "lucide-react";
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

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [users, setUsers] = useState<TopUser[]>([]);
  const reqId = useRef(0);

  // Pinned top-10 users, loaded once.
  useEffect(() => {
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

      {users.length > 0 ? (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-text">Usuários</h2>
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
                      <img
                        src={src}
                        alt=""
                        draggable={false}
                        className="cover-img h-full w-full object-cover"
                      />
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
