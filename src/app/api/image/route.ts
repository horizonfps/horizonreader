import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isAllowedImageHost } from "@/lib/scrapers";
import { getCachedImage, setCachedImage } from "@/lib/imageCache";
import { getDiskImage, setDiskImage } from "@/lib/diskCache";

export const runtime = "nodejs";

const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

// Only Suwayomi image endpoints (covers and pages) are proxyable.
const SUWAYOMI_IMAGE_PATH = /^\/api\/v1\/manga\/\d+\/(thumbnail|chapter\/\d+\/page\/\d+)(\?.*)?$/;

// A scan source dropping one request is routine; a page that fails once used to
// stay blank for the whole session.
const ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const UPSTREAM_TIMEOUT_MS = 20_000;

const IMMUTABLE = "private, max-age=31536000, immutable";
const REVALIDATE = "private, max-age=86400";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Never follow redirects: a whitelisted host answering 30x must not steer the
// server-side fetch to an internal target.
async function fetchUpstream(target: string, headers?: Record<string, string>) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = await fetch(target, {
      cache: "no-store",
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    }).catch(() => null);
    if (res && res.status === 200 && res.body) return res;
    // 4xx other than rate limiting is a real answer; retrying only burns time.
    if (res && res.status !== 429 && res.status >= 400 && res.status < 500) return res;
    if (attempt < ATTEMPTS - 1) await sleep(RETRY_BASE_MS * 2 ** attempt);
    else return res;
  }
  return null;
}

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
    if (u.protocol !== "https:" || !isAllowedImageHost(u.host)) {
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

  // Chapter pages never change, so they get the disk tier and an immutable
  // header. Thumbnails stay memory-only, since a source may swap a cover.
  const isPage = !!ext || path.includes("/chapter/");
  const cacheControl = isPage ? IMMUTABLE : REVALIDATE;

  const hot = getCachedImage(target);
  if (hot) {
    return new NextResponse(new Uint8Array(hot.body), {
      status: 200,
      headers: { "content-type": hot.contentType, "cache-control": cacheControl },
    });
  }

  if (isPage) {
    const cold = await getDiskImage(target);
    if (cold) {
      setCachedImage(target, cold.body, cold.contentType);
      return new NextResponse(new Uint8Array(cold.body), {
        status: 200,
        headers: { "content-type": cold.contentType, "cache-control": cacheControl },
      });
    }
  }

  const upstream = await fetchUpstream(
    target,
    referer ? { "User-Agent": UA, Referer: referer } : undefined,
  );
  if (!upstream || upstream.status !== 200 || !upstream.body) {
    return new NextResponse(null, { status: upstream?.status || 502 });
  }

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  const body = new Uint8Array(await upstream.arrayBuffer());
  setCachedImage(target, body, ct);
  if (isPage) void setDiskImage(target, body, ct);

  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": ct, "cache-control": cacheControl },
  });
}
