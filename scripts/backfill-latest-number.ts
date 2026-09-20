// Fills SourceLink.latestNumber from the saved chapter lists.
//   docker compose exec web npm run backfill-latest-number
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.chapterListCache.findMany({
    select: { sourceLinkId: true, payload: true },
  });
  let updated = 0;
  for (const row of rows) {
    let max = 0;
    try {
      const list = JSON.parse(row.payload) as { chapterNumber?: number }[];
      for (const c of list) {
        const n = c?.chapterNumber;
        if (typeof n === "number" && Number.isFinite(n) && n > max) max = n;
      }
    } catch {
      continue;
    }
    if (max <= 0) continue;
    await prisma.sourceLink
      .update({ where: { id: row.sourceLinkId }, data: { latestNumber: max } })
      .then(() => {
        updated += 1;
      })
      .catch(() => {});
  }
  console.log(`${updated} of ${rows.length} links updated`);
}

main().finally(() => prisma.$disconnect());
