import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";

// Streams Suwayomi covers/pages through the app. Session required; only
// Suwayomi image paths are allowed (SSRF guard).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path.startsWith("/api/v1/")) {
    return NextResponse.json({ error: "bad_path" }, { status: 400 });
  }

  const upstream = await fetch(BASE + path, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, { status: upstream.status || 502 });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("cache-control", "private, max-age=86400");

  return new NextResponse(upstream.body, { status: 200, headers });
}
