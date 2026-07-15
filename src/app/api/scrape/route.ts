// Internal driver for native scrapers: search a source, list chapters, or fetch
// a chapter's pages (returned pre-proxied through /api/image). Session-guarded.

import { getSession } from "@/lib/session";
import { SCRAPERS, getScraper } from "@/lib/scrapers";

export const runtime = "nodejs";

function proxyImage(url: string): string {
  return `/api/image?url=${encodeURIComponent(url)}`;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const action = sp.get("action") || "";

  if (action === "sources") {
    return Response.json({
      sources: SCRAPERS.map((s) => ({ id: s.id, name: s.name, lang: s.lang })),
    });
  }

  const sourceId = sp.get("source") || "";
  const scraper = getScraper(sourceId);
  if (!scraper) return Response.json({ error: "unknown_source" }, { status: 404 });

  try {
    if (action === "search") {
      const q = sp.get("q") || "";
      if (!q.trim()) return Response.json({ items: [] });
      return Response.json({ items: await scraper.search(q) });
    }
    if (action === "chapters") {
      const key = sp.get("key") || "";
      if (!key) return Response.json({ error: "missing_key" }, { status: 400 });
      return Response.json({ chapters: await scraper.chapters(key) });
    }
    if (action === "pages") {
      const key = sp.get("key") || "";
      if (!key) return Response.json({ error: "missing_key" }, { status: 400 });
      const pages = await scraper.pages(key);
      return Response.json({ pages: pages.map(proxyImage), raw: pages });
    }
  } catch (e) {
    return Response.json({ error: "scrape_failed", detail: String(e) }, { status: 502 });
  }
  return Response.json({ error: "bad_action" }, { status: 400 });
}
