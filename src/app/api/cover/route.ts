import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getCachedImage, setCachedImage } from "@/lib/imageCache";

export const runtime = "nodejs";

// Cover files are content-addressed upstream, so long immutable caching is safe.
const CACHE_CONTROL = "public, max-age=604800, immutable";

// Exact hosts allowed. Comick also matches the '.comick.pictures' suffix below.
const ALLOWED_HOSTS = new Set([
  "uploads.mangadex.org",
  "mangadex.org",
  "meo.comick.pictures",
]);

// MangaDex's CDN returns 400 for browser-like ("Mozilla/…") User-Agents; a plain
// token works for both MangaDex and Comick.
const UA = "horizonreader/1.0";

function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host) || host.endsWith(".comick.pictures");
}

// Host-whitelisted image proxy: the browser never hits MangaDex/Comick directly.
// The allowlist is the SSRF guard, so it stays strict (https only, no wildcards,
// no cross-host redirects).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("u") || "";

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "bad_url" }, { status: 400 });
  }

  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return NextResponse.json({ error: "forbidden_host" }, { status: 400 });
  }

  const cacheKey = target.toString();
  const hit = getCachedImage(cacheKey);
  if (hit) {
    return new NextResponse(new Uint8Array(hit.body), {
      status: 200,
      headers: { "Content-Type": hit.contentType, "Cache-Control": CACHE_CONTROL },
    });
  }

  try {
    const headers: Record<string, string> = { "User-Agent": UA };

    const upstream = await fetch(target.toString(), {
      headers,
      // Never follow redirects to an unvalidated host: only a direct 200 is served.
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (upstream.status !== 200 || !upstream.body) {
      return new NextResponse(null, { status: 404 });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const body = new Uint8Array(await upstream.arrayBuffer());
    setCachedImage(cacheKey, body, contentType);

    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
