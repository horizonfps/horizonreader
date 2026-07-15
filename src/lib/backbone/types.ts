// Shared contracts for the metadata backbone (MangaDex / Comick / MangaUpdates)
// and the cross-source dedup + health layer.

export type WorkType = "manga" | "manhwa" | "manhua" | "other";
export type WorkStatus = "ongoing" | "completed" | "hiatus" | "cancelled" | "unknown";
export type BackboneOrigin = "mangadex" | "comick" | "mangaupdates";

// A canonical work as produced by a backbone client, before persistence.
export type BackboneWork = {
  origin: BackboneOrigin;
  externalId: string;
  title: string;
  altTitles: string[]; // every known title, all languages
  description?: string | null;
  coverUrl?: string | null; // absolute URL
  author?: string | null;
  artist?: string | null;
  type?: WorkType | null;
  status?: WorkStatus | null;
  contentRating?: string | null;
  year?: number | null;
  rating?: number | null; // 0..10
  follows?: number | null;
  genres?: string[];
  muId?: string | null; // MangaUpdates id from MangaDex links.mu, if present
};

// A lighter entry for the home sections / grids.
export type SectionItem = {
  origin: "mangadex" | "comick";
  externalId: string;
  slug?: string | null;
  title: string;
  coverUrl?: string | null;
  type?: WorkType | null;
  status?: WorkStatus | null;
  rating?: number | null;
  chapterCount?: number | null;
  genres?: string[]; // for content filtering
  contentRating?: string | null; // for content filtering
};

export type TimeWindow = "7d" | "30d" | "90d" | "6m" | "12m" | "all";

// A dedup candidate already in the local registry (Work rows).
export type RegistryWork = {
  id: number;
  titles: string[]; // canonical title + all alts (raw, not normalized)
};

export type MatchResult = {
  id: number | null;
  score: number; // 0..1 token-set ratio
  action: "merge" | "review" | "new";
};

// Input for scoring which scan source is healthiest for a Work.
export type HealthInput = {
  sourceId: string;
  sourceName?: string | null;
  chapterCount: number;
  latestAt?: Date | null;
};

export function originLangToType(lang?: string | null): WorkType {
  switch ((lang || "").toLowerCase()) {
    case "ja":
      return "manga";
    case "ko":
      return "manhwa";
    case "zh":
    case "zh-hk":
      return "manhua";
    default:
      return "other";
  }
}
