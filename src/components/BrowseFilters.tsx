"use client";

import { usePathname, useRouter } from "next/navigation";

type Genre = { name: string; slug: string; group?: string };
type Current = { type: string; genre: string; sort: string };

const TYPES: { label: string; value: string }[] = [
  { label: "Todos", value: "" },
  { label: "Manga", value: "manga" },
  { label: "Manhwa", value: "manhwa" },
  { label: "Manhua", value: "manhua" },
];

const SORTS: { label: string; value: string }[] = [
  { label: "Popular", value: "popular" },
  { label: "Recentes", value: "latest" },
  { label: "Nota", value: "rating" },
  { label: "Novos", value: "new" },
];

function chipClass(active: boolean): string {
  return active
    ? "rounded-full border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-on-accent"
    : "rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-elevated hover:text-text";
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

  function apply(next: Partial<Current>) {
    const merged = { ...current, ...next };
    const p = new URLSearchParams();
    if (merged.type) p.set("type", merged.type);
    if (merged.genre) p.set("genre", merged.genre);
    if (merged.sort && merged.sort !== "popular") p.set("sort", merged.sort);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Dedupe options by slug to keep the select clean across genre groups.
  const seen = new Set<string>();
  const options = genres.filter((g) => {
    if (!g.slug || seen.has(g.slug)) return false;
    seen.add(g.slug);
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.value || "all"}
            type="button"
            onClick={() => apply({ type: t.value })}
            className={chipClass(current.type === t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Gênero"
          value={current.genre}
          onChange={(e) => apply({ genre: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
        >
          <option value="">Todos os gêneros</option>
          {options.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
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
      </div>
    </div>
  );
}
