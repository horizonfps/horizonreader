// Re-validate every stored Suwayomi SourceLink against its Work's titles with the
// strict matcher and drop links whose source manga is actually a different work
// (fuzzy false-positive from the old token_set-only matching). Native scraper
// links carry no stored source title, so they're left to the normal re-resolve.
//
//   npm run fix-sources

import { PrismaClient } from "@prisma/client";
import { bestTitleSimilarity } from "../src/lib/backbone/normalize.ts";
import { getManga } from "../src/lib/suwayomi.ts";

const prisma = new PrismaClient();
const MATCH_THRESHOLD = 0.8;

function parseArr(json?: string | null): string[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.filter((x: unknown): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

async function main() {
  const works = await prisma.work.findMany({
    select: {
      id: true,
      title: true,
      altTitles: true,
      links: { select: { id: true, sourceMangaId: true, sourceName: true, kind: true } },
    },
  });

  let checked = 0;
  let dropped = 0;
  const touchedWorks = new Set<number>();

  for (const w of works) {
    const titles = [w.title, ...parseArr(w.altTitles)].filter(Boolean);
    for (const link of w.links) {
      if (link.kind === "scraper") continue; // native: source title not stored
      checked++;
      const manga = await getManga(link.sourceMangaId).catch(() => null);
      const srcTitle = (manga?.title || "").trim();
      if (!srcTitle) continue; // can't validate; keep it
      const sim = bestTitleSimilarity([srcTitle], titles);
      if (sim < MATCH_THRESHOLD) {
        await prisma.sourceLink.delete({ where: { id: link.id } }).catch(() => {});
        dropped++;
        touchedWorks.add(w.id);
        console.log(
          `drop link #${link.id} [${link.sourceName ?? "?"}] "${srcTitle}" !~ "${w.title}" (${sim.toFixed(2)})`,
        );
      }
    }
  }

  // Re-promote a healthy primary on works that lost links.
  for (const workId of touchedWorks) {
    const links = await prisma.sourceLink.findMany({
      where: { workId },
      orderBy: { healthScore: "desc" },
      select: { id: true },
    });
    if (!links.length) continue;
    const topId = links[0].id;
    await prisma.sourceLink.updateMany({ where: { workId, id: { not: topId } }, data: { isPrimary: false } });
    await prisma.sourceLink.update({ where: { id: topId }, data: { isPrimary: true } });
  }

  console.log(
    `Done. Checked ${checked} suwayomi links, dropped ${dropped}, re-promoted ${touchedWorks.size} works.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
