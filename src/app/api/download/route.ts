import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  downloadsSnapshot,
  isStorableId,
  queueChapterDownloads,
  removeDownload,
  removeWorkDownloads,
} from "@/lib/downloads";

export const runtime = "nodejs";

type ChapterInput = {
  chapterId: number;
  mangaId?: number;
  workId?: number;
  name?: string;
  number?: number;
};

function int(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return isStorableId(value) ? Number(value) : null;
}

function parseItems(body: unknown): ChapterInput[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const workId = int(b.workId);
  const mangaId = int(b.mangaId);

  if (Array.isArray(b.chapters)) {
    const out: ChapterInput[] = [];
    for (const raw of b.chapters) {
      const c = (raw ?? {}) as Record<string, unknown>;
      const chapterId = int(c.chapterId ?? c.id);
      if (chapterId === null) continue;
      const number = Number(c.number);
      out.push({
        chapterId,
        workId: int(c.workId) ?? workId ?? undefined,
        mangaId: int(c.mangaId) ?? mangaId ?? undefined,
        name: typeof c.name === "string" ? c.name : undefined,
        number: Number.isFinite(number) ? number : undefined,
      });
    }
    return out;
  }

  const legacy = Array.isArray(b.chapterIds)
    ? b.chapterIds.map(int).filter((n): n is number => n !== null)
    : int(b.chapterId) !== null
      ? [int(b.chapterId) as number]
      : [];

  return legacy.map((chapterId) => ({
    chapterId,
    workId: workId ?? undefined,
    mangaId: mangaId ?? undefined,
  }));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const items = parseItems(body);
  if (items.length === 0) return NextResponse.json({ error: "no_ids" }, { status: 400 });

  const { queued, blocked } = await queueChapterDownloads(items);
  return NextResponse.json({ ok: true, queued, blocked });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json(await downloadsSnapshot());
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const chapterId = int(sp.get("chapterId"));
  const workId = int(sp.get("workId"));

  if (chapterId !== null) {
    const removed = (await removeDownload(chapterId)) ? 1 : 0;
    return NextResponse.json({ ok: true, removed });
  }
  if (workId !== null) {
    return NextResponse.json({ ok: true, removed: await removeWorkDownloads(workId) });
  }
  return NextResponse.json({ error: "no_ids" }, { status: 400 });
}
