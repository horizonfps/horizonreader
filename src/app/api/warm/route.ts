import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveWorkFromRef, queueSourceResolve, sweepModeForWork } from "@/lib/backbone/resolve";
import { refreshChapters } from "@/lib/chapterCache";
import { warmWorkChapters } from "@/lib/chapterWarm";

export const runtime = "nodejs";

// Cheap prefetch target: canonicalize the ref and queue source resolution in
// the background lane, replying immediately. Viewport warming hits this
// instead of rendering full work pages, which used to saturate the server.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const href = typeof body?.href === "string" ? body.href : "";

  try {
    if (href.startsWith("/work/")) {
      const url = new URL(href, "http://internal");
      const slug = decodeURIComponent(url.pathname.slice("/work/".length));
      const work = await prisma.work.findUnique({ where: { slug }, select: { id: true } });
      if (work) {
        const sourceId = Number(url.searchParams.get("src"));
        if (Number.isInteger(sourceId) && sourceId > 0) {
          const link = await prisma.sourceLink
            .findFirst({ where: { id: sourceId, workId: work.id } })
            .catch(() => null);
          if (link) {
            void refreshChapters(link).catch(() => {});
            void warmWorkChapters(work.id);
            return NextResponse.json({ ok: true });
          }
        }
        queueSourceResolve(work.id);
        void warmWorkChapters(work.id);
      }
    } else if (href.startsWith("/w/")) {
      const url = new URL(href, "http://internal");
      const [, , origin, externalId] = url.pathname.split("/");
      if ((origin === "mangadex" || origin === "comick") && externalId) {
        const resolved = await resolveWorkFromRef({
          origin,
          externalId: decodeURIComponent(externalId),
          title: url.searchParams.get("t"),
          coverUrl: url.searchParams.get("c"),
        });
        if (resolved) {
          queueSourceResolve(resolved.workId);
          void warmWorkChapters(resolved.workId);
        }
      }
    }
  } catch {
    /* warm is best-effort */
  }
  return NextResponse.json({ ok: true });
}

// State of a work's warm: how many sources it has, how many already carry a
// stored chapter list, and which pass the next resolve would run.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slug = (req.nextUrl.searchParams.get("slug") || "").trim();
  if (!slug) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const work = await prisma.work
    .findUnique({ where: { slug }, select: { id: true } })
    .catch(() => null);
  if (!work) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [links, suwayomiCached, scraperCached, mode] = await Promise.all([
    prisma.sourceLink.count({ where: { workId: work.id } }).catch(() => 0),
    prisma.chapterListCache.count({ where: { sourceLink: { workId: work.id } } }).catch(() => 0),
    prisma.sourceLink
      .count({ where: { workId: work.id, kind: "scraper", scrapedChapters: { some: {} } } })
      .catch(() => 0),
    sweepModeForWork(work.id),
  ]);

  void warmWorkChapters(work.id);

  return NextResponse.json({
    ok: true,
    workId: work.id,
    links,
    cached: suwayomiCached + scraperCached,
    mode,
  });
}
