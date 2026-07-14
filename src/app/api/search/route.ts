import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backboneToCard } from "@/lib/cards";
import { searchMangaDex } from "@/lib/backbone/mangadex";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ items: [] });

  try {
    const works = await searchMangaDex(q, 24);
    return NextResponse.json({ items: works.map(backboneToCard) });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
