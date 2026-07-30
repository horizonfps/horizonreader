import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { chapterPageUrls } from "@/lib/readerPages";

export const runtime = "nodejs";

// GET /api/chapter-pages?id=<chapterId>&limit=<n> -- first pages of a chapter,
// used by the reader to warm the next chapter before the user gets there.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 5) : 3;

  const urls = await chapterPageUrls(id, limit);
  return NextResponse.json({ urls });
}
