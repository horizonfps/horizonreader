// One-off migration: works stored with a CJK title get an English or romanized
// title refetched from MangaDex; non-ASCII slugs are regenerated as ASCII.
//
//   npm run fix-titles

import { PrismaClient } from "@prisma/client";
import { norm, matchKeys, slugify } from "../src/lib/backbone/normalize.ts";

const prisma = new PrismaClient();

const CJK = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;
const BAD_SLUG = /[^a-z0-9-]/;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) horizonreader",
  Accept: "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function parseArr(json?: string | null): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x: unknown): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

type Attrs = { title?: Record<string, string>; altTitles?: Record<string, string>[] };

// Mirrors englishTitle in src/lib/backbone/mangadex.ts.
function pickLatinTitle(a: Attrs): string | null {
  if (a.title?.en) return a.title.en;
  for (const alt of a.altTitles ?? []) if (alt?.en) return alt.en;
  const romanized = (o?: Record<string, string>) => {
    for (const [k, v] of Object.entries(o ?? {})) if (k.endsWith("-ro") && v) return v;
    return null;
  };
  const latin = (o?: Record<string, string>) => {
    for (const v of Object.values(o ?? {})) if (v && !CJK.test(v)) return v;
    return null;
  };
  let ro = romanized(a.title);
  for (const alt of a.altTitles ?? []) {
    if (ro) break;
    ro = romanized(alt);
  }
  if (ro) return ro;
  let l = latin(a.title);
  for (const alt of a.altTitles ?? []) {
    if (l) break;
    l = latin(alt);
  }
  return l;
}

async function fetchAttrs(id: string): Promise<Attrs | null> {
  try {
    const res = await fetch(`https://api.mangadex.org/manga/${encodeURIComponent(id)}`, {
      headers: HEADERS,
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: { attributes?: Attrs } };
    return d?.data?.attributes ?? null;
  } catch {
    return null;
  }
}

async function uniqueSlug(base: string, workId: number): Promise<string> {
  let candidate = base;
  let n = 1;
  for (;;) {
    const clash = await prisma.work.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash || clash.id === workId) return candidate;
    candidate = `${base}-${n++}`;
  }
}

async function main() {
  const works = await prisma.work.findMany({
    select: { id: true, origin: true, externalId: true, title: true, slug: true, altTitles: true },
  });
  const broken = works.filter((w) => CJK.test(w.title) || BAD_SLUG.test(w.slug));
  console.log(`${broken.length} of ${works.length} works need fixing`);

  let fixed = 0;
  for (const w of broken) {
    let title = w.title;
    if (CJK.test(title) && w.origin === "mangadex") {
      const attrs = await fetchAttrs(w.externalId);
      await sleep(300);
      const better = attrs ? pickLatinTitle(attrs) : null;
      if (better) title = better;
    }

    let slug = w.slug;
    if (BAD_SLUG.test(slug)) {
      slug = await uniqueSlug(slugify(title, shortHash(w.externalId)), w.id);
    }

    if (title === w.title && slug === w.slug) {
      console.log(`#${w.id} unchanged (no latin title found): ${w.title}`);
      continue;
    }

    const titles = [...new Set([title, w.title, ...parseArr(w.altTitles)])].filter(Boolean);
    await prisma.work.update({
      where: { id: w.id },
      data: {
        title,
        slug,
        normalizedKey: norm(title),
        altTitles: JSON.stringify(titles),
        matchKeys: JSON.stringify(matchKeys(titles)),
      },
    });
    fixed++;
    console.log(`#${w.id} "${w.title}" -> "${title}" (${slug})`);
  }
  console.log(`Done. ${fixed} fixed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
