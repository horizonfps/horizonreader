// Scanlator-aware chapter shaping shared by the work page and the reader.
// A "scan group" is one scanlator's run of a manga inside a single source, so
// next/prev never jumps between different scanlators' uploads of the same number.

export type RawChapter = {
  id: number;
  name: string;
  chapterNumber: number;
  scanlator?: string | null;
  uploadDate?: string | null;
};

export function scanlatorKey(s?: string | null): string {
  return (s || "").trim();
}

// Suwayomi uploadDate is epoch millis as a string; fall back to Date.parse.
export function uploadMs(c: { uploadDate?: string | null }): number {
  const s = c.uploadDate;
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

// Collapse re-uploads of the same numbered chapter to one, newest upload wins.
// keepId always survives its number so the reader never loses the open chapter.
export function dedupeByNumber<T extends RawChapter>(chapters: T[], keepId?: number): T[] {
  const best = new Map<string, T>();
  const passthrough: T[] = [];
  for (const c of chapters) {
    if (!(c.chapterNumber > 0)) {
      passthrough.push(c); // unknown number: can't dedup safely
      continue;
    }
    const k = String(c.chapterNumber);
    const cur = best.get(k);
    if (!cur) {
      best.set(k, c);
    } else if (c.id === keepId || (cur.id !== keepId && uploadMs(c) >= uploadMs(cur))) {
      best.set(k, c);
    }
  }
  return [...passthrough, ...best.values()];
}

export type ScanGroup<T extends RawChapter> = {
  key: string; // scanlatorKey ("" when the source reports no scanlator)
  count: number;
  latestMs: number;
  chapters: T[];
};

// Split a source's chapters by scanlator, ranked by size then recency.
export function groupByScanlator<T extends RawChapter>(chapters: T[]): ScanGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const c of chapters) {
    const k = scanlatorKey(c.scanlator);
    const arr = map.get(k);
    if (arr) arr.push(c);
    else map.set(k, [c]);
  }
  const groups = [...map.entries()].map(([key, chs]) => {
    let latestMs = 0;
    for (const c of chs) latestMs = Math.max(latestMs, uploadMs(c));
    return { key, count: chs.length, latestMs, chapters: chs };
  });
  groups.sort((a, b) => b.count - a.count || b.latestMs - a.latestMs);
  return groups;
}
