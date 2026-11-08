import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const MAX = 8;

const normalizeLoose = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Matches username or display name; prefix hits rank above substring hits.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = normalizeLoose((req.nextUrl.searchParams.get("q") ?? "").replace(/^@/, ""));
  if (!q) return NextResponse.json({ users: [] });

  const users = await prisma.user
    .findMany({ select: { username: true, displayName: true, avatarUrl: true, isAdmin: true } })
    .catch(() => []);

  const scored = users
    .map((u) => {
      const names = [u.username, u.displayName ?? ""].map(normalizeLoose);
      const score = names.some((n) => n.startsWith(q)) ? 2 : names.some((n) => n.includes(q)) ? 1 : 0;
      return { u, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.u.username.localeCompare(b.u.username))
    .slice(0, MAX)
    .map((x) => x.u);

  return NextResponse.json({ users: scored });
}
