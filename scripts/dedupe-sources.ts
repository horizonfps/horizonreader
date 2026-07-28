// Collapse SourceLinks left over from the old resolver, which linked every
// search result above the match threshold and so put one scan site on a work
// several times. Keeps the richest link per source and re-promotes a primary.
//
//   npm run dedupe-sources

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const works = await prisma.work.findMany({
    select: {
      id: true,
      title: true,
      links: {
        select: { id: true, sourceId: true, sourceName: true, chapterCount: true, healthScore: true },
      },
    },
  });

  let dropped = 0;
  const touched = new Set<number>();

  for (const w of works) {
    const keep = new Map<string, (typeof w.links)[number]>();
    const drop: number[] = [];
    for (const l of w.links) {
      const cur = keep.get(l.sourceId);
      if (!cur) {
        keep.set(l.sourceId, l);
        continue;
      }
      const better =
        l.chapterCount > cur.chapterCount ||
        (l.chapterCount === cur.chapterCount && l.healthScore > cur.healthScore);
      if (better) {
        keep.set(l.sourceId, l);
        drop.push(cur.id);
      } else {
        drop.push(l.id);
      }
    }
    if (!drop.length) continue;
    await prisma.sourceLink.deleteMany({ where: { id: { in: drop } } });
    dropped += drop.length;
    touched.add(w.id);
    console.log(`${w.title}: ${w.links.length} -> ${keep.size} links (-${drop.length})`);
  }

  for (const workId of touched) {
    const links = await prisma.sourceLink.findMany({
      where: { workId },
      orderBy: { healthScore: "desc" },
      select: { id: true },
    });
    if (!links.length) continue;
    const topId = links[0].id;
    await prisma.sourceLink.updateMany({
      where: { workId, id: { not: topId } },
      data: { isPrimary: false },
    });
    await prisma.sourceLink.update({ where: { id: topId }, data: { isPrimary: true } });
  }

  console.log(`Done. Dropped ${dropped} duplicate links across ${touched.size} works.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
