// Background indexing for backbone list items: persists the work record so a
// later click resolves straight to /work/[slug], without delaying the list
// response. Queue shape mirrors queueSourceResolve/pumpBackground in resolve.ts.

import type { BackboneWork, SectionItem } from "@/lib/backbone/types";
import { isBlocked } from "@/lib/backbone/filter";
import { upsertWork, resolveWorkFromRef } from "@/lib/backbone/resolve";

const CONCURRENCY = 4;
const QUEUE_CAP = 200;
const MDX_COOLDOWN_MS = 6 * 3_600_000;
const COMICK_COOLDOWN_MS = 24 * 3_600_000;

type Job = { key: string; run: () => Promise<unknown> };

const queue: Job[] = [];
const queued = new Set<string>();
const cooldownAt = new Map<string, number>();
let active = 0;

function enqueue(key: string, cooldownMs: number, run: () => Promise<unknown>): void {
  const last = cooldownAt.get(key);
  if (last !== undefined && Date.now() - last < cooldownMs) return;
  if (queued.has(key) || queue.length >= QUEUE_CAP) return;
  queued.add(key);
  queue.push({ key, run });
  pump();
}

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active += 1;
    cooldownAt.set(job.key, Date.now());
    job
      .run()
      .catch(() => {})
      .finally(() => {
        queued.delete(job.key);
        active -= 1;
        pump();
      });
  }
}

// MangaDex items already carry the full BackboneWork, so indexing them is a
// plain DB upsert: no network involved.
export function indexBackboneWorks(works: BackboneWork[]): void {
  for (const bw of works) {
    if (bw.origin !== "mangadex" || !bw.externalId) continue;
    if (isBlocked({ genres: bw.genres, contentRating: bw.contentRating })) continue;
    enqueue(`${bw.origin}:${bw.externalId}`, MDX_COOLDOWN_MS, () => upsertWork(bw));
  }
}

// Comick items must canonicalize through resolveWorkFromRef (matches onto the
// MangaDex entry and applies content policy); upsertWork direct would create
// duplicate works with poor alt titles.
export function indexComickItems(items: SectionItem[]): void {
  for (const it of items) {
    if (it.origin !== "comick" || it.localSlug || !it.externalId) continue;
    if (isBlocked({ genres: it.genres, contentRating: it.contentRating })) continue;
    enqueue(`${it.origin}:${it.externalId}`, COMICK_COOLDOWN_MS, () =>
      resolveWorkFromRef({
        origin: "comick",
        externalId: it.externalId,
        title: it.title,
        coverUrl: it.coverUrl,
        type: it.type,
        status: it.status,
      }),
    );
  }
}
