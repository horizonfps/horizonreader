import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fetchChapterPages, getChapters, proxied, pageUrl } from "@/lib/suwayomi";
import Reader from "@/components/Reader";

export const dynamic = "force-dynamic";

export default async function ReaderPage({ params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId: cidStr } = await params;
  const chapterId = Number(cidStr);
  const session = await getSession();
  if (!Number.isInteger(chapterId) || !session) notFound();

  const data = await fetchChapterPages(chapterId).catch(() => null);
  if (!data) notFound();

  const { pages, mangaId, sourceOrder, pageCount } = data;
  const urls =
    pages && pages.length > 0
      ? pages.map((p) => proxied(p))
      : Array.from({ length: pageCount }, (_, i) => pageUrl(mangaId, sourceOrder, i));

  const chapters = await getChapters(mangaId).catch(() => []);
  const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const idx = ordered.findIndex((c) => c.id === chapterId);
  const prevId = idx > 0 ? ordered[idx - 1].id : null;
  const nextId = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].id : null;
  const title = idx >= 0 ? ordered[idx].name : "";
  const chapterNumber = idx >= 0 ? ordered[idx].chapterNumber : undefined;

  // Resolve the canonical work so progress carries workId + chapterNumber and
  // the reader can link back to the work page.
  const link = await prisma.sourceLink.findFirst({
    where: { sourceMangaId: mangaId },
    include: { work: true },
  });
  const workId = link?.workId ?? null;
  const workSlug = link?.work?.slug ?? null;

  const prog = await prisma.progress.findUnique({
    where: { userId_chapterId: { userId: session.uid, chapterId } },
  });
  const initialPage = Math.min(Math.max(prog?.lastPageRead ?? 0, 0), Math.max(urls.length - 1, 0));

  return (
    <Reader
      key={chapterId}
      chapterId={chapterId}
      mangaId={mangaId}
      workId={workId}
      workSlug={workSlug}
      chapterNumber={chapterNumber}
      pageUrls={urls}
      initialPage={initialPage}
      title={title}
      prevChapterId={prevId}
      nextChapterId={nextId}
    />
  );
}
