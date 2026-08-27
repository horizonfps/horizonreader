import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// A row marked read without ever turning a page is one the app filled in by
// itself when an later chapter was finished.
function autoWhere(userId: number, workId: number | null, mangaId: number | null) {
  const scope: object[] = [];
  if (workId !== null) scope.push({ workId });
  if (mangaId !== null) scope.push({ mangaId });
  return {
    userId,
    read: true,
    lastPageRead: 0,
    ...(scope.length ? { OR: scope } : {}),
  };
}

function intParam(req: NextRequest, name: string): number | null {
  const raw = req.nextUrl.searchParams.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// GET /api/progress/auto?workId=&mangaId= -> how many rows the app marked alone
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const where = autoWhere(session.uid, intParam(req, "workId"), intParam(req, "mangaId"));
  const count = await prisma.progress.count({ where }).catch(() => 0);
  return NextResponse.json({ count });
}

// DELETE /api/progress/auto?workId=&mangaId= -> drops them; no params = every work
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const where = autoWhere(session.uid, intParam(req, "workId"), intParam(req, "mangaId"));
  try {
    const result = await prisma.progress.deleteMany({ where });
    return NextResponse.json({ ok: true, removed: result.count });
  } catch {
    return NextResponse.json({ ok: false, removed: 0 }, { status: 200 });
  }
}
