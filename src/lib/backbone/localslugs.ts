// Batch-maps known (origin, externalId) pairs to local Work slugs so cards link
// straight to /work/[slug], skipping the /w/ resolver hop. Server-side only.

import { prisma } from "@/lib/db";
import type { SectionItem } from "@/lib/backbone/types";

export async function attachLocalSlugs(lists: SectionItem[][]): Promise<void> {
  const byOrigin = new Map<string, Set<string>>();
  for (const list of lists) {
    for (const it of list) {
      if (!it || it.localSlug || !it.externalId) continue;
      let set = byOrigin.get(it.origin);
      if (!set) byOrigin.set(it.origin, (set = new Set()));
      set.add(it.externalId);
    }
  }
  if (!byOrigin.size) return;

  try {
    const rows = await prisma.work.findMany({
      where: {
        OR: [...byOrigin.entries()].map(([origin, ids]) => ({
          origin,
          externalId: { in: [...ids] },
        })),
      },
      select: { origin: true, externalId: true, slug: true },
    });
    const slugs = new Map(rows.map((r) => [`${r.origin}:${r.externalId}`, r.slug]));
    for (const list of lists) {
      for (const it of list) {
        if (!it || it.localSlug) continue;
        const slug = slugs.get(`${it.origin}:${it.externalId}`);
        if (slug) it.localSlug = slug;
      }
    }
  } catch {
    // Cards fall back to the /w/ bridge.
  }
}
