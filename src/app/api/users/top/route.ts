import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Top 10 users, ranked by favorites count (most active first).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const users = await prisma.user.findMany({
      select: {
        username: true,
        displayName: true,
        avatarUrl: true,
        isAdmin: true,
        _count: { select: { favorites: true } },
      },
    });

    const ranked = users
      .map((u) => ({
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        isAdmin: u.isAdmin,
        favorites: u._count.favorites,
      }))
      .sort((a, b) => b.favorites - a.favorites || a.username.localeCompare(b.username))
      .slice(0, 10);

    return NextResponse.json({ users: ranked });
  } catch {
    return NextResponse.json({ users: [] });
  }
}
