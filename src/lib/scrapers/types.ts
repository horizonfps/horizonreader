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
};

export interface Scraper {
  id: string; // stable id, e.g. "madara:mangaread"
  name: string; // display name
  lang: string; // "en" | "pt-BR"
  base: string; // origin, for referer/whitelist
  search(query: string): Promise<ScraperManga[]>;
  chapters(mangaKey: string): Promise<ScraperChapter[]>;
  pages(chapterKey: string): Promise<string[]>; // absolute image URLs
}
