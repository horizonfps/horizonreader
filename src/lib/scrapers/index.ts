// Registry of native scrapers (sources scraped directly, outside Suwayomi).

import type { Scraper } from "./types";
import { createMadara } from "./madara";
import { createMangaDex } from "./mangadex";

export const SCRAPERS: Scraper[] = [
  // MangaDex first: no challenge solver, and works that came from its catalogue
  // link by uuid, so they never depend on a scan site indexing the title.
  createMangaDex({
    id: "mangadex:en",
    name: "MangaDex (EN)",
    lang: "en",
    apiLangs: ["en"],
  }),
  createMangaDex({
    id: "mangadex:pt-br",
    name: "MangaDex (PT-BR)",
    lang: "pt-BR",
    apiLangs: ["pt-br", "pt"],
  }),
  createMadara({
    id: "madara:mangaread",
    name: "MangaRead",
    lang: "en",
    base: "https://www.mangaread.org",
  }),
  createMadara({
    id: "madara:mangalivre",
    name: "Manga Livre",
    lang: "pt-BR",
    base: "https://mangalivre.to",
  }),
  createMadara({
    id: "madara:hossmanhwa",
    name: "Hoss Manhwa",
    lang: "pt-BR",
    base: "https://hossmanhwa.com",
  }),
  createMadara({
    id: "madara:kamisama",
    name: "Kami Sama Explorer",
    lang: "pt-BR",
    base: "https://leitor.kamisama.com.br",
  }),
];

export function getScraper(id: string): Scraper | undefined {
  return SCRAPERS.find((s) => s.id === id);
}

export function scraperHosts(): Set<string> {
  return new Set(SCRAPERS.map((s) => new URL(s.base).host));
}

// Image proxy whitelist: a source's own host plus any CDN it declares. Entries
// starting with a dot match subdomains, which is how MangaDex@Home works.
export function isAllowedImageHost(host: string): boolean {
  const h = host.toLowerCase();
  for (const s of SCRAPERS) {
    if (new URL(s.base).host.toLowerCase() === h) return true;
    for (const extra of s.imageHosts ?? []) {
      const e = extra.toLowerCase();
      if (e.startsWith(".") ? h.endsWith(e) : h === e) return true;
    }
  }
  return false;
}

export type { Scraper } from "./types";
