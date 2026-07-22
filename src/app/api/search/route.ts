import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { searchWorks } from "@/lib/backbone/search";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ items: [] });

  try {
    const items = await searchWorks(q);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
