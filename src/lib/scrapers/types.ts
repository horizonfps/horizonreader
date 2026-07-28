// Native scraper contracts: sources scraped directly by the app, outside the
// Suwayomi/Tachiyomi engine. Keys are absolute URLs so they are self-describing.

export type ScraperManga = {
  key: string; // manga page URL
  title: string;
  coverUrl?: string | null;
};

export type ScraperChapter = {
  key: string; // chapter page URL
  name: string;
  number: number;
  date?: number | null; // epoch ms
  scanlator?: string | null;
};

export interface Scraper {
  id: string; // stable id, e.g. "madara:mangaread"
  name: string; // display name
  lang: string; // "en" | "pt-BR"
  base: string; // origin, for referer/whitelist
  // Extra hosts serving page images. A leading dot matches any subdomain.
  imageHosts?: string[];
  // Rides the challenge solver, so a pass costs tens of seconds and must never
  // run in front of a page render.
  heavy?: boolean;
  search(query: string): Promise<ScraperManga[]>;
  chapters(mangaKey: string): Promise<ScraperChapter[]>;
  pages(chapterKey: string): Promise<string[]>; // absolute image URLs
  // Source key derived straight from the backbone id, skipping title matching.
  directKey?(origin: string, externalId: string): string | null;
}
