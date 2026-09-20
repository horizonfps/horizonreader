import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { STATUS_ORDER, type FavStatus } from "@/lib/cards";
import LibraryView, { type LibraryItem } from "@/components/LibraryView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Biblioteca" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { status } = await searchParams;
  const active = STATUS_ORDER.includes(status as FavStatus) ? (status as FavStatus) : null;

  const favorites = await prisma.favorite
    .findMany({
      where: { userId: session.uid },
      include: { work: { include: { links: { select: { chapterCount: true } } } } },
      orderBy: { updatedAt: "desc" },
    })
    .catch(() => []);

  const workIds = favorites.map((f) => f.workId);
  const progress = workIds.length
    ? await prisma.progress
        .findMany({
          where: { userId: session.uid, workId: { in: workIds } },
          select: { workId: true, chapterNumber: true, updatedAt: true },
        })
        .catch(() => [])
    : [];
  const last = new Map<number, { chapter: number; at: number }>();
  for (const p of progress) {
    if (p.workId == null) continue;
    const cur = last.get(p.workId);
    const at = p.updatedAt.getTime();
    if (!cur) last.set(p.workId, { chapter: p.chapterNumber, at });
    else {
      last.set(p.workId, {
        chapter: Math.max(cur.chapter, p.chapterNumber),
        at: Math.max(cur.at, at),
      });
    }
  }

  const items: LibraryItem[] = favorites
    .filter((f) => f.work)
    .map((f) => {
      const l = last.get(f.workId);
      return {
        id: f.id,
        status: f.status,
        updatedAt: f.updatedAt.getTime(),
        slug: f.work.slug,
        title: f.work.title,
        coverUrl: f.work.coverUrl,
        rating: f.work.rating,
        type: f.work.type,
        workStatus: f.work.status,
        lastChapter: l && l.chapter > 0 ? l.chapter : null,
        lastReadAt: l?.at ?? null,
        chapterCount: Math.max(0, ...f.work.links.map((x) => x.chapterCount)),
      };
    });

  return <LibraryView items={items} initialStatus={active} />;
}
