import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { updateLibrary } from "@/lib/suwayomi";

export const runtime = "nodejs";

// Kicks a full Suwayomi library update, a heavy global operation: admin only.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await updateLibrary();
  return NextResponse.json({ ok: true });
}
