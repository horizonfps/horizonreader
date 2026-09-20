import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const WHERE = {
  links: { some: {} },
  NOT: { contentRating: "pornographic" },
};

// Relative Location: behind the tunnel the request carries the internal host.
function to(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path, "cache-control": "no-store" } });
}

export async function GET() {
  const session = await getSession();
  if (!session) return to("/login");

  const count = await prisma.work.count({ where: WHERE }).catch(() => 0);
  if (!count) return to("/browse");
  const pick = await prisma.work
    .findFirst({ where: WHERE, skip: Math.floor(Math.random() * count), select: { slug: true } })
    .catch(() => null);
  return to(pick ? `/work/${encodeURIComponent(pick.slug)}` : "/browse");
}
