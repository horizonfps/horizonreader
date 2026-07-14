import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { enqueueDownload } from "@/lib/suwayomi";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids: number[] = Array.isArray(body?.chapterIds)
    ? body.chapterIds.map(Number).filter(Number.isInteger)
    : Number.isInteger(Number(body?.chapterId))
      ? [Number(body.chapterId)]
      : [];

  if (ids.length === 0) return NextResponse.json({ error: "no_ids" }, { status: 400 });

  await enqueueDownload(ids);
  return NextResponse.json({ ok: true, queued: ids.length });
}
