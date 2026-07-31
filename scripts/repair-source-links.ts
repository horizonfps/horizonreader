// Drop source links whose engine manga id no longer names the work they were
// created for. Engine manga ids are local to its own database, so a rebuilt or
// migrated engine reassigns them: the stored id then points at an unrelated
// title, and the work page renders no chapters or, worse, another work's.
//
//   npm run repair-source-links -- --dry-run
//   npm run repair-source-links

import { PrismaClient } from "@prisma/client";
import { getMangaSourceIds } from "../src/lib/suwayomi.ts";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const BATCH = 100;

async function main() {
  const links = await prisma.sourceLink.findMany({
    where: { NOT: { kind: "scraper" } },
    select: { id: true, workId: true, sourceId: true, sourceName: true, sourceMangaId: true },
  });
  console.log(`links via engine: ${links.length}${dryRun ? " (dry run)" : ""}`);

  const stale: typeof links = [];
  let missing = 0;
  let reassigned = 0;
  let checked = 0;

  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    let owners: Map<number, string | null>;
    try {
      owners = await getMangaSourceIds(batch.map((l) => l.sourceMangaId));
    } catch (e) {
      // An engine hiccup is not evidence a link is wrong, so skip the batch.
      console.warn(`  batch ${i}: ${String(e).slice(0, 120)}`);
      continue;
    }
    for (const link of batch) {
      const owner = owners.get(link.sourceMangaId) ?? null;
      if (owner === null) {
        missing += 1;
        stale.push(link);
      } else if (owner !== link.sourceId) {
        reassigned += 1;
        stale.push(link);
      }
    }
    checked += batch.length;
    if (i % (BATCH * 10) === 0) console.log(`  ${checked}/${links.length}`);
  }

  console.log(
    `\nchecked ${checked} | stale ${stale.length} (${missing} missing, ${reassigned} now another source)`,
  );
  if (dryRun) {
    for (const l of stale.slice(0, 20)) {
      console.log(`  would drop ${l.sourceName} (work ${l.workId}, manga ${l.sourceMangaId})`);
    }
    if (stale.length > 20) console.log(`  ... and ${stale.length - 20} more`);
    return;
  }
  if (!stale.length) return;

  const ids = stale.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await prisma.chapterListCache.deleteMany({ where: { sourceLinkId: { in: chunk } } });
    await prisma.sourceLink.deleteMany({ where: { id: { in: chunk } } });
  }

  const orphaned = await prisma.work.count({ where: { links: { none: {} } } });
  console.log(`dropped ${ids.length} links | works with no link now: ${orphaned}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
