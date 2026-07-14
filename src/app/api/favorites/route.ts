import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { STATUS_ORDER } from "@/lib/cards";

export const runtime = "nodejs";

// GET: list the session user's library, newest touched first.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: session.uid },
      include: { work: true },
      orderBy: { updatedAt: "desc" },
    });

    const items = favorites.map((f) => ({
      favoriteId: f.id,
      status: f.status,
      rating: f.rating,
      workId: f.workId,
      slug: f.work.slug,
      title: f.work.title,
      coverUrl: f.work.coverUrl,
      type: f.work.type,
      workStatus: f.work.status,
      workRating: f.work.rating,
      genres: f.work.genres,
    }));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

// POST/PUT: add or update a library entry with reading status.
async function upsertFavorite(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { workId?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const workId = Number(body.workId);
  if (!Number.isInteger(workId) || workId <= 0) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const status =
    typeof body.status === "string" && (STATUS_ORDER as readonly string[]).includes(body.status)
      ? body.status
      : "READING";

  try {
    await prisma.favorite.upsert({
      where: { userId_workId: { userId: session.uid, workId } },
      create: { userId: session.uid, workId, status },
      update: { status },
    });
    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  return upsertFavorite(req);
}

export async function PUT(req: Request) {
  return upsertFavorite(req);
}

// DELETE: remove a work from the session user's library.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { workId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const workId = Number(body.workId);
  if (!Number.isInteger(workId) || workId <= 0) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    await prisma.favorite.deleteMany({ where: { userId: session.uid, workId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
