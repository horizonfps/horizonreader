// Registry of native scrapers (sources scraped directly, outside Suwayomi).

import type { Scraper } from "./types";
import { createMadara } from "./madara";

export const SCRAPERS: Scraper[] = [
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

export type { Scraper } from "./types";
