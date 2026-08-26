// Where "Continuar" should land: the furthest point already reached, never a
// chapter the reader skipped. Pure, so the work page and /continue share it.

export type ResumeKind = "start" | "resume" | "next" | "reread";
export type ResumeTarget = { chapterId: number; chapterNumber: number; kind: ResumeKind };

type AscChapter = { id: number; chapterNumber: number };
type ProgressRow = { chapterId: number; read: boolean; lastPageRead: number; updatedAt: Date };

export function pickResumeChapter(
  ascChapters: AscChapter[],
  progress: ProgressRow[],
): ResumeTarget | null {
  if (!ascChapters.length) return null;

  const indexById = new Map<number, number>();
  ascChapters.forEach((chapter, i) => indexById.set(chapter.id, i));

  const known = progress.filter((p) => indexById.has(p.chapterId));
  if (!known.length) {
    const first = ascChapters[0];
    return { chapterId: first.id, chapterNumber: first.chapterNumber, kind: "start" };
  }

  let anchor = known[0];
  let anchorIdx = indexById.get(anchor.chapterId)!;
  for (const row of known.slice(1)) {
    const idx = indexById.get(row.chapterId)!;
    const num = ascChapters[idx].chapterNumber;
    const anchorNum = ascChapters[anchorIdx].chapterNumber;
    const better =
      num > anchorNum ||
      (num === anchorNum && row.updatedAt.getTime() > anchor.updatedAt.getTime());
    if (better) {
      anchor = row;
      anchorIdx = idx;
    }
  }

  const anchorChapter = ascChapters[anchorIdx];
  if (!anchor.read) {
    return { chapterId: anchorChapter.id, chapterNumber: anchorChapter.chapterNumber, kind: "resume" };
  }

  const next = ascChapters[anchorIdx + 1];
  if (!next) {
    return { chapterId: anchorChapter.id, chapterNumber: anchorChapter.chapterNumber, kind: "reread" };
  }
  return { chapterId: next.id, chapterNumber: next.chapterNumber, kind: "next" };
}

export function formatChapterNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(2)));
}
