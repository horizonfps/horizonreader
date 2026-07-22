import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { scraperHosts } from "@/lib/scrapers";
import { getCachedImage, setCachedImage } from "@/lib/imageCache";

export const runtime = "nodejs";

const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

// Only Suwayomi image endpoints (covers and pages) are proxyable.
const SUWAYOMI_IMAGE_PATH = /^\/api\/v1\/manga\/\d+\/(thumbnail|chapter\/\d+\/page\/\d+)(\?.*)?$/;

// Streams Suwayomi covers/pages and native-scraper page images through the app.
// Session required; only Suwayomi paths and whitelisted scraper hosts are allowed
// (SSRF guard). Scraper images carry a Referer to defeat hotlink protection.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const path = sp.get("path") || "";
  const ext = sp.get("url") || "";

  let target: string;
  let referer: string | undefined;

  if (ext) {
    let u: URL;
    try {
      u = new URL(ext);
    } catch {
      return NextResponse.json({ error: "bad_url" }, { status: 400 });
    }
    if (u.protocol !== "https:" || !scraperHosts().has(u.host)) {
      return NextResponse.json({ error: "host_not_allowed" }, { status: 400 });
    }
    target = u.toString();
    referer = `${u.protocol}//${u.host}/`;
  } else {
    if (!SUWAYOMI_IMAGE_PATH.test(path)) {
      return NextResponse.json({ error: "bad_path" }, { status: 400 });
    }
    target = BASE + path;
  }

  // Thumbnails are small and hit constantly (library/work grids); pages stream.
  const cacheable = !ext && path.includes("/thumbnail");
  if (cacheable) {
    const hit = getCachedImage(target);
    if (hit) {
      return new NextResponse(new Uint8Array(hit.body), {
        status: 200,
        headers: { "content-type": hit.contentType, "cache-control": "private, max-age=86400" },
      });
    }
  }

  // Never follow redirects: a whitelisted host answering 30x must not steer the
  // server-side fetch to an internal target.
  const upstream = await fetch(target, {
    cache: "no-store",
    redirect: "manual",
    headers: referer ? { "User-Agent": UA, Referer: referer } : undefined,
  }).catch(() => null);
  if (!upstream || upstream.status !== 200 || !upstream.body) {
    return new NextResponse(null, { status: upstream?.status || 502 });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("cache-control", "private, max-age=86400");

  if (cacheable) {
    const body = new Uint8Array(await upstream.arrayBuffer());
    setCachedImage(target, body, ct || "application/octet-stream");
    return new NextResponse(body, { status: 200, headers });
  }

  return new NextResponse(upstream.body, { status: 200, headers });
}
