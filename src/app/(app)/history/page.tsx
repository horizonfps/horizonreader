import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import HistoryList, { type HistoryEntry } from "@/components/HistoryList";

export const dynamic = "force-dynamic";

export const metadata = { title: "Histórico" };

const LIMIT = 300;

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) return null;

  const rows = await prisma.readingHistory
    .findMany({
      where: { userId: session.uid },
      include: { work: { select: { slug: true, title: true, coverUrl: true } } },
      orderBy: { readAt: "desc" },
      take: LIMIT,
    })
    .catch(() => []);

  const entries: HistoryEntry[] = rows.map((r) => ({
    id: r.id,
    chapterId: r.chapterId,
    chapterNumber: r.chapterNumber,
    lastPageRead: r.lastPageRead,
    readAt: r.readAt.toISOString(),
    work: r.work,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Histórico</h1>
      <HistoryList entries={entries} now={Date.now()} />
    </div>
  );
}
