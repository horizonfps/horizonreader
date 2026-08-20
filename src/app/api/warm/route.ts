import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveWorkFromRef, queueSourceResolve } from "@/lib/backbone/resolve";
import { refreshChapters } from "@/lib/chapterCache";

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
            return NextResponse.json({ ok: true });
          }
        }
        queueSourceResolve(work.id);
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
        if (resolved) queueSourceResolve(resolved.workId);
      }
    }
  } catch {
    /* warm is best-effort */
  }
  return NextResponse.json({ ok: true });
}
