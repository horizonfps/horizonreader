// Recently updated infinite feed (MangaDex latest chapter uploads).

import { getSession } from "@/lib/session";
import { listMangaDex } from "@/lib/backbone/mangadex";
import { isBlocked } from "@/lib/backbone/filter";
import { backboneToCard } from "@/lib/cards";

export const runtime = "nodejs";

const PAGE = 24;
const MAX_OFFSET = 10000;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("cursor");
  let offset = raw ? Number(raw) : 0;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.min(Math.floor(offset), MAX_OFFSET);

  try {
    const works = await listMangaDex({
      order: { latestUploadedChapter: "desc" },
      limit: PAGE,
      offset,
    });
    const items = works
      .map(backboneToCard)
      .filter((c) => !isBlocked({ genres: c.genres, contentRating: c.contentRating }));
    // Page fullness uses the raw fetch count so pagination is not cut short by filtering.
    const nextCursor =
      works.length === PAGE && offset + PAGE <= MAX_OFFSET ? offset + PAGE : null;
    return Response.json({ items, nextCursor });
  } catch {
    return Response.json({ items: [], nextCursor: null });
  }
}
