"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";

type Genre = { name: string; slug: string; group?: string };
type Current = { type: string; genre: string; sort: string; status: string };

const TYPES: { label: string; value: string }[] = [
  { label: "Todos", value: "" },
  { label: "Mangá", value: "manga" },
  { label: "Manhwa", value: "manhwa" },
  { label: "Manhua", value: "manhua" },
];

const SORTS: { label: string; value: string }[] = [
  { label: "Populares", value: "popular" },
  { label: "Atualizados", value: "latest" },
  { label: "Melhor nota", value: "rating" },
  { label: "Novos", value: "new" },
];

const STATUSES: { label: string; value: string }[] = [
  { label: "Qualquer status", value: "" },
  { label: "Em andamento", value: "ongoing" },
  { label: "Completos", value: "completed" },
  { label: "Em hiato", value: "hiatus" },
];

function chipClass(active: boolean): string {
  return active
    ? "shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent"
    : "shrink-0 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-elevated hover:text-text";
}

export default function BrowseFilters({
  genres,
  current,
}: {
  genres: Genre[];
  current: Current;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [genresOpen, setGenresOpen] = useState(!!current.genre);

  function apply(next: Partial<Current>) {
    const merged = { ...current, ...next };
    const p = new URLSearchParams();
    if (merged.type) p.set("type", merged.type);
    if (merged.genre) p.set("genre", merged.genre);
    if (merged.status) p.set("status", merged.status);
    if (merged.sort && merged.sort !== "popular") p.set("sort", merged.sort);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const seen = new Set<string>();
  const options = genres.filter((g) => {
    if (!g.slug || seen.has(g.slug)) return false;
    seen.add(g.slug);
    return true;
  });
  const activeGenre = options.find((g) => g.slug === current.genre);

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => apply({ sort: s.value })}
            className={chipClass(current.sort === s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {TYPES.map((t) => (
            <button
              key={t.value || "all"}
              type="button"
              onClick={() => apply({ type: t.value })}
              className={`px-3 py-1.5 text-xs font-medium ${
                current.type === t.value ? "bg-elevated text-text" : "text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          aria-label="Status"
          value={current.status}
          onChange={(e) => apply({ status: e.target.value })}
          className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text outline-none focus:border-accent"
        >
          {STATUSES.map((s) => (
            <option key={s.value || "any"} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setGenresOpen((v) => !v)}
          aria-expanded={genresOpen}
          className={`flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs ${
            activeGenre ? "border-accent text-accent" : "border-border text-muted hover:text-text"
          }`}
        >
          {activeGenre ? activeGenre.name : "Gênero"}
          {activeGenre ? (
            <X
              className="h-3.5 w-3.5"
              onClick={(e) => {
                e.stopPropagation();
                apply({ genre: "" });
              }}
            />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {genresOpen ? (
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface/60 p-3">
          {options.map((g) => (
            <button
              key={g.slug}
              type="button"
              onClick={() => apply({ genre: current.genre === g.slug ? "" : g.slug })}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                current.genre === g.slug
                  ? "bg-accent text-on-accent"
                  : "bg-elevated text-text/80 hover:bg-accent/15 hover:text-accent"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
