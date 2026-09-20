"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Star } from "lucide-react";
import MangaCard from "@/components/MangaCard";
import { coverProxy, STATUS_ORDER, STATUS_LABELS, type FavStatus } from "@/lib/cards";
import { typeLabel, statusLabel, timeAgo } from "@/lib/labels";
import { formatChapterNumber } from "@/lib/continueReading";

export type LibraryItem = {
  id: number;
  status: string;
  updatedAt: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  rating: number | null;
  type: string | null;
  workStatus: string | null;
  lastChapter: number | null;
  lastReadAt: number | null;
  chapterCount: number;
};

type Sort = "recent" | "read" | "title" | "rating";
type View = "grid" | "list";

const SORT_LABEL: Record<Sort, string> = {
  recent: "Adicionados",
  read: "Lidos por último",
  title: "Título",
  rating: "Nota",
};

const VIEW_KEY = "library:view";

// Chapters past the furthest one read, capped so a rough count never reads as exact.
function unreadOf(it: LibraryItem): string | null {
  if (!it.chapterCount || !it.lastChapter) return null;
  const n = Math.floor(it.chapterCount - it.lastChapter);
  if (n <= 0) return null;
  return n > 99 ? "+99" : String(n);
}

export default function LibraryView({
  items,
  initialStatus,
}: {
  items: LibraryItem[];
  initialStatus: FavStatus | null;
}) {
  const [status, setStatus] = useState<FavStatus | null>(initialStatus);
  const [sort, setSort] = useState<Sort>("read");
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem(VIEW_KEY) as View) || "grid";
  });
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = status ? items.filter((i) => i.status === status) : items;
    if (needle) list = list.filter((i) => i.title.toLowerCase().includes(needle));
    const by: Record<Sort, (a: LibraryItem, b: LibraryItem) => number> = {
      recent: (a, b) => b.updatedAt - a.updatedAt,
      read: (a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.updatedAt - a.updatedAt,
      title: (a, b) => a.title.localeCompare(b.title, "pt-BR"),
      rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
    };
    return [...list].sort(by[sort]);
  }, [items, status, sort, q]);

  function pickStatus(s: FavStatus | null) {
    setStatus(s);
    window.history.replaceState(null, "", s ? `/library?status=${s}` : "/library");
  }

  function pickView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
      on ? "bg-accent text-on-accent" : "bg-surface text-muted hover:bg-elevated hover:text-text"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold tracking-tight">Biblioteca</h1>
        <span className="text-xs text-muted">{shown.length} de {items.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar"
            aria-label="Filtrar biblioteca"
            className="h-9 w-32 rounded-lg border border-border bg-surface px-3 text-sm outline-none placeholder:text-muted focus:border-accent sm:w-48"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Ordenar"
            className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text outline-none"
          >
            {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => pickView("grid")}
              aria-label="Grade"
              aria-pressed={view === "grid"}
              className={`flex h-9 w-9 items-center justify-center ${view === "grid" ? "bg-elevated text-text" : "text-muted hover:text-text"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => pickView("list")}
              aria-label="Lista"
              aria-pressed={view === "list"}
              className={`flex h-9 w-9 items-center justify-center ${view === "list" ? "bg-elevated text-text" : "text-muted hover:text-text"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        <button type="button" onClick={() => pickStatus(null)} className={chip(status === null)}>
          Todos <span className="opacity-70">{items.length}</span>
        </button>
        {STATUS_ORDER.map((key) => (
          <button key={key} type="button" onClick={() => pickStatus(key)} className={chip(status === key)}>
            {STATUS_LABELS[key]} <span className="opacity-70">{counts[key] ?? 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-sm text-muted">{items.length ? "Nada com esse filtro." : "Nada aqui ainda."}</p>
          {!items.length ? (
            <Link
              href="/browse"
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              Explorar
            </Link>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
          {shown.map((it, i) => (
            <MangaCard
              key={it.id}
              priority={i < 6}
              href={`/work/${it.slug}`}
              badge={unreadOf(it)}
              item={{
                origin: "mangadex",
                externalId: "",
                localSlug: it.slug,
                title: it.title,
                coverUrl: it.coverUrl,
                rating: it.rating,
                type: it.type as any,
              }}
              caption={
                it.lastChapter
                  ? `Cap. ${formatChapterNumber(it.lastChapter)}${it.chapterCount ? ` de ${it.chapterCount}` : ""}`
                  : it.chapterCount
                    ? `${it.chapterCount} caps.`
                    : null
              }
            />
          ))}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface/40">
          {shown.map((it) => {
            const src = coverProxy(it.coverUrl);
            const pct =
              it.lastChapter && it.chapterCount
                ? Math.min(100, Math.round((it.lastChapter / it.chapterCount) * 100))
                : null;
            return (
              <li key={it.id} className="border-b border-border/70 last:border-b-0">
                <Link href={`/work/${it.slug}`} className="flex items-center gap-3 px-3 py-2 hover:bg-elevated/60">
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-elevated">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" className="cover-img h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{it.title}</p>
                    <p className="truncate text-xs text-muted">
                      {[typeLabel(it.type), statusLabel(it.workStatus)].filter(Boolean).join(" · ")}
                      {it.chapterCount ? ` · ${it.chapterCount} caps.` : ""}
                    </p>
                    {pct != null ? (
                      <div className="mt-1.5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-elevated">
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="hidden shrink-0 text-right text-xs text-muted sm:block">
                    {it.lastChapter ? <p className="text-text">Cap. {formatChapterNumber(it.lastChapter)}</p> : null}
                    {it.lastReadAt ? <p>{timeAgo(it.lastReadAt)}</p> : null}
                  </div>
                  {it.rating != null ? (
                    <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted">
                      <Star className="h-3 w-3 fill-accent text-accent" />
                      {it.rating.toFixed(1)}
                    </span>
                  ) : null}
                  <span className="hidden shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted md:inline">
                    {STATUS_LABELS[it.status] ?? it.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
