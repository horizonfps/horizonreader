import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await getSession();
  if (!session?.isAdmin) return null;
  return session;
}

function parseWorkId(body: unknown): number | null {
  const id = (body as { workId?: unknown } | null)?.workId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const workId = parseWorkId(await req.json().catch(() => null));
  if (!workId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true } });
  if (!work) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.horizonPick.upsert({
    where: { workId },
    create: { workId },
    update: {},
  });
  return NextResponse.json({ picked: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const workId = parseWorkId(await req.json().catch(() => null));
  if (!workId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  await prisma.horizonPick.deleteMany({ where: { workId } });
  return NextResponse.json({ picked: false });
}
