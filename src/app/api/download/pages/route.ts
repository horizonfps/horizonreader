import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// The reader marks a downloaded page with dl=1 so the image service worker
// keeps it apart from the pre-download response.
function downloadUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}dl=1`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const chapterId = Number(req.nextUrl.searchParams.get("chapterId"));
  if (!Number.isInteger(chapterId)) {
    return NextResponse.json({ error: "no_ids" }, { status: 400 });
  }

  const row = await prisma.chapterDownload
    .findUnique({
      where: { chapterId },
      include: { work: { select: { title: true, slug: true } } },
    })
    .catch(() => null);
  if (!row || row.status !== "DONE") {
    return NextResponse.json({ error: "not_downloaded" }, { status: 404 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.pages);
  } catch {
    parsed = null;
  }
  const urls = (Array.isArray(parsed) ? parsed : [])
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .map(downloadUrl);

  return NextResponse.json({
    chapterId: row.chapterId,
    chapterName: row.chapterName,
    workTitle: row.work?.title ?? null,
    workSlug: row.work?.slug ?? null,
    urls,
  });
}
