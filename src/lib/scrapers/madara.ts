// Generic adapter for Madara (WordPress WP-Manga) sites. One config per site.
// Verified against mangaread.org (en) and flowermangas.net (pt-BR).

import type { Scraper, ScraperManga, ScraperChapter } from "./types";
import { getText, postForm } from "./http";

type MadaraConfig = { id: string; name: string; lang: string; base: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, "’")
    .trim();
}

function parseNumber(name: string): number {
  const m = name.match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(",", ".")) : 0;
}

function parseDate(s?: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

export function createMadara(cfg: MadaraConfig): Scraper {
  const ajax = `${cfg.base}/wp-admin/admin-ajax.php`;

  async function search(query: string): Promise<ScraperManga[]> {
    const body = await postForm(
      ajax,
      { action: "wp-manga-search-manga", title: query },
      cfg.base,
    );
    let json: { success?: boolean; data?: { title: string; url: string; type?: string }[] };
    try {
      json = JSON.parse(body);
    } catch {
      return [];
    }
    if (!json.success || !Array.isArray(json.data)) return [];
    return json.data
      .filter((d) => d.url && d.title)
      .map((d) => ({ key: d.url, title: decodeEntities(d.title) }));
  }

  function parseChapters(html: string): ScraperChapter[] {
    const out: ScraperChapter[] = [];
    const liRe =
      /<li[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(html))) {
      const block = m[1];
      const a = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const key = a[1].trim();
      const name = decodeEntities(a[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      const dateM = block.match(/<i>([^<]+)<\/i>/i) || block.match(/release-date[^>]*>([^<]+)</i);
      out.push({ key, name, number: parseNumber(name), date: parseDate(dateM?.[1]) });
    }
    return out;
  }

  // Three known Madara chapter-list transports, tried in order: the classic
  // {mangaUrl}/ajax/chapters/ endpoint, the newer admin-ajax manga_get_chapters
  // (keyed by the holder's data-id), then the inline list on the manga page.
  async function chapters(mangaKey: string): Promise<ScraperChapter[]> {
    try {
      const html = await postForm(`${mangaKey.replace(/\/+$/, "")}/ajax/chapters/`, {}, mangaKey);
      const chs = parseChapters(html);
      if (chs.length) return chs;
    } catch {
      /* fall through */
    }

    const page = await getText(mangaKey, mangaKey).catch(() => "");
    const holderId = page.match(/manga-chapters-holder"[^>]*data-id="(\d+)"/i)?.[1];
    if (holderId) {
      try {
        const html = await postForm(
          ajax,
          { action: "manga_get_chapters", manga: holderId },
          mangaKey,
        );
        const chs = parseChapters(html);
        if (chs.length) return chs;
      } catch {
        /* fall through */
      }
    }
    return parseChapters(page);
  }

  async function pages(chapterKey: string): Promise<string[]> {
    const html = await getText(chapterKey, chapterKey);
    const imgs = html.match(/<img[^>]*wp-manga-chapter-img[^>]*>/gi) ?? [];
    const urls: string[] = [];
    for (const tag of imgs) {
      const src =
        tag.match(/\sdata-src="([^"]+)"/i)?.[1] ??
        tag.match(/\ssrc="([^"]+)"/i)?.[1] ??
        "";
      const clean = src.replace(/[\s\n\t]/g, "").trim();
      if (clean.startsWith("http")) urls.push(clean);
    }
    return urls;
  }

  return { id: cfg.id, name: cfg.name, lang: cfg.lang, base: cfg.base, search, chapters, pages };
}
