// MangaUpdates client (api.mangaupdates.com/v1, no auth). Server-side only.

import type { WorkType, WorkStatus } from "@/lib/backbone/types";

const BASE = "https://api.mangaupdates.com/v1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) horizonreader";

type MuSearchResult = {
  id: string;
  title: string;
  type: WorkType | null;
  year: number | null;
  rating: number | null;
  genres: string[];
};

type MuSeries = {
  associated: string[];
  type: WorkType | null;
  status: WorkStatus | null;
  completed: boolean;
  genres: string[];
  year: number | null;
};

export function muTypeToWorkType(t?: string | null): WorkType {
  switch ((t || "").trim().toLowerCase()) {
    case "manga":
      return "manga";
    case "manhwa":
      return "manhwa";
    case "manhua":
      return "manhua";
    default:
      return "other";
  }
}

// null when type text is absent, so unknown stays unknown (not "other").
function muType(t?: string | null): WorkType | null {
  return t && t.trim() ? muTypeToWorkType(t) : null;
}

// MU status is free text like "115 Volumes (Ongoing)"; parse keywords.
function muStatus(s?: string | null): WorkStatus | null {
  const t = (s || "").toLowerCase();
  if (!t.trim()) return null;
  if (t.includes("hiatus")) return "hiatus";
  if (t.includes("cancel") || t.includes("discontinu") || t.includes("dropped"))
    return "cancelled";
  if (t.includes("complet")) return "completed";
  if (t.includes("ongoing")) return "ongoing";
  return "unknown";
}

function parseYear(y: unknown): number | null {
  const n = parseInt(String(y ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseGenres(g: unknown): string[] {
  if (!Array.isArray(g)) return [];
  return g
    .map((x) => (x && typeof x === "object" ? (x as { genre?: string }).genre : null))
    .filter((x): x is string => !!x && !!x.trim());
}

export async function searchMangaUpdates(q: string): Promise<MuSearchResult[]> {
  try {
    const res = await fetch(`${BASE}/series/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ search: q, perpage: 15 }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .map((r: { record?: Record<string, unknown> }) => r?.record)
      .filter(Boolean)
      .map((rec: Record<string, unknown>) => ({
        id: String(rec.series_id ?? ""),
        title: String(rec.title ?? ""),
        type: muType(rec.type as string | null),
        year: parseYear(rec.year),
        rating: typeof rec.bayesian_rating === "number" ? rec.bayesian_rating : null,
        genres: parseGenres(rec.genres),
      }))
      .filter((r: MuSearchResult) => r.id && r.title);
  } catch {
    return [];
  }
}

export async function getMangaUpdatesSeries(id: string): Promise<MuSeries | null> {
  try {
    const res = await fetch(`${BASE}/series/${encodeURIComponent(id)}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || typeof d !== "object") return null;
    const associated = Array.isArray(d.associated)
      ? d.associated
          .map((a: { title?: string }) => a?.title)
          .filter((t: unknown): t is string => !!t && typeof t === "string")
      : [];
    return {
      associated,
      type: muType(d.type),
      status: muStatus(d.status),
      completed: d.completed === true,
      genres: parseGenres(d.genres),
      year: parseYear(d.year),
    };
  } catch {
    return null;
  }
}
