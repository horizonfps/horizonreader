import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { removeDownload } from "@/lib/downloads";

export const runtime = "nodejs";

type Scope = "error" | "done" | "all";

const SCOPE_FILTERS: Record<Scope, { status?: string }> = {
  error: { status: "ERROR" },
  done: { status: "DONE" },
  all: {},
};

function parseScope(value: unknown): Scope | null {
  return value === "error" || value === "done" || value === "all" ? value : null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { scope?: unknown } | null;
  const scope = parseScope(body?.scope);
  if (!scope) return NextResponse.json({ error: "bad_scope" }, { status: 400 });

  const rows = await prisma.chapterDownload
    .findMany({ where: SCOPE_FILTERS[scope], select: { chapterId: true, bytes: true } })
    .catch(() => []);

  let removed = 0;
  let bytesFreed = 0;
  for (const row of rows) {
    if (await removeDownload(row.chapterId)) {
      removed += 1;
      bytesFreed += row.bytes;
    }
  }

  return NextResponse.json({ ok: true, removed, bytesFreed });
}
