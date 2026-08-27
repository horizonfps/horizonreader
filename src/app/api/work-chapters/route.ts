import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildSourceView } from "@/lib/workChapters";

export const runtime = "nodejs";

// Chapter list of one source link, bounded by buildSourceView's budget: a slow
// source answers "pending" instead of leaving the client hanging.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("link");
  const linkId = Number(raw);
  if (!raw || !Number.isInteger(linkId)) {
    return NextResponse.json({ error: "bad_link" }, { status: 400 });
  }

  const link = await prisma.sourceLink.findUnique({ where: { id: linkId } }).catch(() => null);
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const view = await buildSourceView(link, { uid: session.uid }).catch(() => null);
  if (!view) return NextResponse.json({ status: "pending" });
  return NextResponse.json({ status: "ready", view });
}
