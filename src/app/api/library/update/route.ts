import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { updateLibrary } from "@/lib/suwayomi";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await updateLibrary();
  return NextResponse.json({ ok: true });
}
