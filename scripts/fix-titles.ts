// Re-derives MangaDex titles with the current preference and regenerates
// non-ASCII slugs as ASCII.
//
//   npm run fix-titles [-- --dry-run]

import { PrismaClient } from "@prisma/client";
import { norm, matchKeys, slugify } from "../src/lib/backbone/normalize.ts";

const prisma = new PrismaClient();

const CJK = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;
const BAD_SLUG = /[^a-z0-9-]/;
// MangaDex rejects requests missing this browser-like header set.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) horizonreader",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
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
  const romanized = (o?: Record<string, string>, prefix = "") => {
    for (const [k, v] of Object.entries(o ?? {}))
      if (k.startsWith(prefix) && k.endsWith("-ro") && v && !CJK.test(v)) return v;
    return null;
  };
  const latin = (o?: Record<string, string>) => {
    for (const v of Object.values(o ?? {})) if (v && !CJK.test(v)) return v;
    return null;
  };
  if (a.title?.en) return a.title.en;
  const romaji = romanized(a.title, "ja");
  if (romaji) return romaji;
  for (const alt of a.altTitles ?? []) if (alt?.en) return alt.en;
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

async function fetchAttrsBatch(ids: string[]): Promise<Map<string, Attrs>> {
  const out = new Map<string, Attrs>();
  const qs = new URLSearchParams({ limit: String(ids.length) });
  for (const id of ids) qs.append("ids[]", id);
  for (const r of ["safe", "suggestive", "erotica", "pornographic"]) qs.append("contentRating[]", r);
  try {
    const res = await fetch(`https://api.mangadex.org/manga?${qs}`, { headers: HEADERS });
    if (!res.ok) return out;
    const d = (await res.json()) as { data?: { id: string; attributes?: Attrs }[] };
    for (const m of d.data ?? []) if (m.attributes) out.set(m.id, m.attributes);
  } catch {
    // batch skipped; rerun picks it up
  }
  return out;
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
  const dryRun = process.argv.includes("--dry-run");
  const works = await prisma.work.findMany({
    select: { id: true, origin: true, externalId: true, title: true, slug: true, altTitles: true },
  });

  const fresh = new Map<number, string>();
  const mdx = works.filter((w) => w.origin === "mangadex");
  for (let i = 0; i < mdx.length; i += 100) {
    const batch = mdx.slice(i, i + 100);
    const attrs = await fetchAttrsBatch(batch.map((w) => w.externalId));
    for (const w of batch) {
      const a = attrs.get(w.externalId);
      const t = a ? pickLatinTitle(a) : null;
      if (t && t !== w.title) fresh.set(w.id, t);
    }
    await sleep(300);
  }

  const broken = works.filter((w) => fresh.has(w.id) || BAD_SLUG.test(w.slug));
  console.log(`${broken.length} of ${works.length} works need fixing`);

  let fixed = 0;
  for (const w of broken) {
    const title = fresh.get(w.id) ?? w.title;
    let slug = w.slug;
    const placeholder = title !== w.title && slug.startsWith("work-");
    if (BAD_SLUG.test(slug) || placeholder) {
      slug = await uniqueSlug(slugify(title, shortHash(w.externalId)), w.id);
    }
    if (title === w.title && slug === w.slug) continue;

    console.log(`#${w.id} "${w.title}" -> "${title}" (${slug})`);
    if (dryRun) continue;
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
  }
  console.log(`Done. ${fixed} fixed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
