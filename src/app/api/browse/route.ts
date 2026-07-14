// Browse grid: filter MangaDex by type/genre with sort, infinite offset cursor.

import { getSession } from "@/lib/session";
import { listMangaDex } from "@/lib/backbone/mangadex";
import { resolveGenreTag } from "@/lib/backbone/tags";
import { backboneToCard } from "@/lib/cards";

export const runtime = "nodejs";

const PAGE = 24;
const MAX_OFFSET = 10000;

const LANG_BY_TYPE: Record<string, string> = {
  manga: "ja",
  manhwa: "ko",
  manhua: "zh",
};

const ORDER_BY_SORT: Record<string, Record<string, "asc" | "desc">> = {
  popular: { followedCount: "desc" },
  latest: { latestUploadedChapter: "desc" },
  rating: { rating: "desc" },
  new: { createdAt: "desc" },
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") || "";
  const genre = sp.get("genre") || "";
  const sort = sp.get("sort") || "popular";

  const raw = sp.get("cursor");
  let offset = raw ? Number(raw) : 0;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.min(Math.floor(offset), MAX_OFFSET);

  try {
    const order = ORDER_BY_SORT[sort] ?? ORDER_BY_SORT.popular;
    const lang = LANG_BY_TYPE[type];
    const tagId = genre ? await resolveGenreTag(genre) : null;

    const works = await listMangaDex({
      order,
      originalLanguage: lang ? [lang] : undefined,
      includedTags: tagId ? [tagId] : undefined,
      limit: PAGE,
      offset,
    });
    const items = works.map(backboneToCard);
    const nextCursor =
      items.length === PAGE && offset + PAGE <= MAX_OFFSET ? offset + PAGE : null;
    return Response.json({ items, nextCursor });
  } catch {
    return Response.json({ items: [], nextCursor: null });
  }
}
