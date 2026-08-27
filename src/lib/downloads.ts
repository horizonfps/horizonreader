// Server-side chapter download queue: pulls every page of a chapter into the
// `download` disk tier, which no cache sweep ever evicts. One worker per
// process, resumable across restarts.

import { mkdir, statfs } from "node:fs/promises";

import { prisma } from "@/lib/db";
import { deleteDiskImage, getDiskImage, setDiskImage, tierDir } from "@/lib/diskCache";
import { getPolicy, queueGate, type Gate, type Policy } from "@/lib/downloadPolicy";
import { chapterPageUrls } from "@/lib/readerPages";
import { isAllowedImageHost } from "@/lib/scrapers";

const BASE = process.env.SUWAYOMI_URL || "http://localhost:4567";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const SUWAYOMI_IMAGE_PATH = /^\/api\/v1\/manga\/\d+\/(thumbnail|chapter\/\d+\/page\/\d+)(\?.*)?$/;

const CONCURRENCY = 4;
const ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const PAGE_TIMEOUT_MS = 20_000;
const CHAPTER_DEADLINE_MS = 10 * 60_000;
const PROGRESS_EVERY = 5;

export type DownloadItem = {
  chapterId: number;
  workId: number | null;
  workTitle: string | null;
  workSlug: string | null;
  chapterName: string;
  chapterNumber: number;
  status: string;
  pageCount: number;
  pagesDone: number;
  bytes: number;
  error: string | null;
  owner: string | null;
  updatedAt: string;
};

export type DownloadUserUsage = {
  userId: number;
  username: string;
  bytes: number;
  chapters: number;
  quotaMb: number;
  quotaBytes: number;
};

export type DownloadStorage = {
  path: string;
  downloadsBytes: number;
  chapters: number;
  diskTotal: number;
  diskFree: number;
  diskUsed: number;
  quotaBytes: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// SQLite Int columns are 32-bit; a bigger id would be written and then poison
// every later read of the table.
const INT32_MAX = 2_147_483_647;

export function isStorableId(value: unknown): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= -INT32_MAX - 1 && n <= INT32_MAX;
}

// Turns a proxied /api/image url back into the origin target, which is the key
// the disk tiers are addressed by.
export function originTargetFor(
  proxiedUrl: string,
): { target: string; referer?: string } | null {
  try {
    const u = new URL(proxiedUrl, "http://internal");
    const urlParam = u.searchParams.get("url");
    const pathParam = u.searchParams.get("path") || "";

    if (urlParam) {
      let ext: URL;
      try {
        ext = new URL(urlParam);
      } catch {
        return null;
      }
      if (ext.protocol !== "https:" || !isAllowedImageHost(ext.host)) return null;
      return { target: ext.toString(), referer: `${ext.protocol}//${ext.host}/` };
    }
    if (SUWAYOMI_IMAGE_PATH.test(pathParam)) return { target: BASE + pathParam };
    return null;
  } catch {
    return null;
  }
}

function parsePages(raw: string): string[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export async function freeBytesOnDownloadDisk(): Promise<number> {
  const dir = tierDir("download");
  await mkdir(dir, { recursive: true }).catch(() => {});
  const fs = await statfs(dir).catch(() => null);
  return fs ? Number(fs.bavail) * Number(fs.bsize) : Infinity;
}

async function totalDownloadBytes(): Promise<number> {
  const rows = await prisma.chapterDownload.findMany({ select: { bytes: true } }).catch(() => []);
  return rows.reduce((acc, r) => acc + r.bytes, 0);
}

export async function userDownloadBytes(userId: number): Promise<number> {
  try {
    const agg = await prisma.chapterDownload.aggregate({
      _sum: { bytes: true },
      where: { userId },
    });
    return agg._sum.bytes ?? 0;
  } catch {
    return 0;
  }
}

// Own quota wins; 0 falls back to the policy default. 0 on both = no limit.
function effectiveQuotaMb(ownQuotaMb: number, policy: Policy): number {
  return ownQuotaMb > 0 ? ownQuotaMb : policy.perUserQuotaMb;
}

async function userQuotaMb(userId: number, policy: Policy): Promise<number> {
  const user = await prisma.user
    .findUnique({ where: { id: userId }, select: { downloadQuotaMb: true } })
    .catch(() => null);
  return effectiveQuotaMb(user?.downloadQuotaMb ?? 0, policy);
}

// Age cleanup first, then quota: drops the oldest finished chapters until the
// total fits under 90% of the quota.
export async function enforceStorage(): Promise<{ removed: number; bytesFreed: number }> {
  let removed = 0;
  let bytesFreed = 0;
  try {
    const policy = await getPolicy();

    if (policy.keepDays > 0) {
      const cutoff = new Date(Date.now() - policy.keepDays * 86_400_000);
      const stale = await prisma.chapterDownload
        .findMany({ where: { status: "DONE", updatedAt: { lt: cutoff } } })
        .catch(() => []);
      for (const row of stale) {
        if (await removeDownload(row.chapterId)) {
          removed += 1;
          bytesFreed += row.bytes;
        }
      }
    }

    if (policy.quotaMb > 0) {
      const quota = policy.quotaMb * 1024 * 1024;
      let total = await totalDownloadBytes();
      while (total > quota) {
        const oldest = await prisma.chapterDownload
          .findFirst({ where: { status: "DONE" }, orderBy: { updatedAt: "asc" } })
          .catch(() => null);
        if (!oldest) break;
        if (!(await removeDownload(oldest.chapterId))) break;
        removed += 1;
        bytesFreed += oldest.bytes;
        total -= oldest.bytes;
        if (total <= quota * 0.9) break;
      }
    }

    const perUser = await prisma.chapterDownload
      .groupBy({ by: ["userId"], _sum: { bytes: true } })
      .catch(() => [] as { userId: number | null; _sum: { bytes: number | null } }[]);

    for (const group of perUser) {
      const userId = group.userId;
      if (userId === null) continue;
      const quotaMb = await userQuotaMb(userId, policy);
      if (quotaMb <= 0) continue;
      const quota = quotaMb * 1024 * 1024;
      let total = group._sum.bytes ?? 0;
      while (total > quota) {
        const oldest = await prisma.chapterDownload
          .findFirst({ where: { status: "DONE", userId }, orderBy: { updatedAt: "asc" } })
          .catch(() => null);
        if (!oldest) break;
        if (!(await removeDownload(oldest.chapterId))) break;
        removed += 1;
        bytesFreed += oldest.bytes;
        total -= oldest.bytes;
        if (total <= quota * 0.9) break;
      }
    }
  } catch {
    /* housekeeping never breaks the caller */
  }
  return { removed, bytesFreed };
}

export async function queueChapterDownloads(
  items: { chapterId: number; mangaId?: number; workId?: number; name?: string; number?: number }[],
  userId: number | null = null,
): Promise<{ queued: number; blocked: "quota" | "user_quota" | null }> {
  const policy = await getPolicy();
  if (policy.quotaMb > 0) {
    const quota = policy.quotaMb * 1024 * 1024;
    if ((await totalDownloadBytes()) >= quota) {
      await enforceStorage();
      if ((await totalDownloadBytes()) >= quota) return { queued: 0, blocked: "quota" };
    }
  }

  if (userId !== null) {
    const quotaMb = await userQuotaMb(userId, policy);
    if (quotaMb > 0 && (await userDownloadBytes(userId)) >= quotaMb * 1024 * 1024) {
      return { queued: 0, blocked: "user_quota" };
    }
  }

  let queued = 0;
  for (const item of items) {
    const chapterId = Number(item.chapterId);
    if (!isStorableId(chapterId)) continue;
    try {
      const existing = await prisma.chapterDownload.findUnique({ where: { chapterId } });
      if (!existing) {
        await prisma.chapterDownload.create({
          data: {
            chapterId,
            mangaId: isStorableId(item.mangaId) ? Number(item.mangaId) : 0,
            workId: isStorableId(item.workId) ? Number(item.workId) : null,
            chapterName: item.name ?? "",
            chapterNumber: Number.isFinite(Number(item.number)) ? Number(item.number) : 0,
            status: "QUEUED",
            userId,
          },
        });
        queued += 1;
      } else if (existing.status === "ERROR") {
        await prisma.chapterDownload.update({
          where: { chapterId },
          data: {
            status: "QUEUED",
            pagesDone: 0,
            bytes: 0,
            error: null,
            ...(userId !== null ? { userId } : {}),
            ...(item.name ? { chapterName: item.name } : {}),
            ...(Number.isFinite(Number(item.number)) ? { chapterNumber: Number(item.number) } : {}),
            ...(isStorableId(item.workId) ? { workId: Number(item.workId) } : {}),
          },
        });
        queued += 1;
      }
    } catch {
      /* a row that cannot be written is not a queued row */
    }
  }
  void runQueue();
  return { queued, blocked: null };
}

type PageResult = { bytes: number; ok: boolean };

async function storePage(proxiedUrl: string): Promise<PageResult> {
  const origin = originTargetFor(proxiedUrl);
  if (!origin) return { bytes: 0, ok: false };
  const { target, referer } = origin;

  const already = await getDiskImage(target, "download");
  if (already) return { bytes: already.body.byteLength, ok: true };

  const warm = await getDiskImage(target, "page");
  if (warm) {
    await setDiskImage(target, warm.body, warm.contentType, "download");
    return { bytes: warm.body.byteLength, ok: true };
  }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = await fetch(target, {
      cache: "no-store",
      redirect: "manual",
      headers: referer ? { "User-Agent": UA, Referer: referer } : undefined,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    }).catch(() => null);

    if (res && res.status === 200) {
      const body = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (body.byteLength) {
        await setDiskImage(
          target,
          body,
          res.headers.get("content-type") || "application/octet-stream",
          "download",
        );
        return { bytes: body.byteLength, ok: true };
      }
    }
    if (attempt < ATTEMPTS - 1) await sleep(RETRY_BASE_MS * 2 ** attempt);
  }
  return { bytes: 0, ok: false };
}

async function downloadChapter(chapterId: number): Promise<void> {
  const started = Date.now();

  const urls = await chapterPageUrls(chapterId, Number.MAX_SAFE_INTEGER);
  if (!urls.length) {
    await prisma.chapterDownload
      .update({ where: { chapterId }, data: { status: "ERROR", error: "sem páginas" } })
      .catch(() => null);
    return;
  }

  await prisma.chapterDownload
    .update({
      where: { chapterId },
      data: { pages: JSON.stringify(urls), pageCount: urls.length, pagesDone: 0, bytes: 0 },
    })
    .catch(() => null);

  let done = 0;
  let bytes = 0;
  let failed = false;
  let timedOut = false;
  let next = 0;

  const flush = () =>
    prisma.chapterDownload
      .update({ where: { chapterId }, data: { pagesDone: done, bytes } })
      .catch(() => null);

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed || timedOut) return;
      if (Date.now() - started > CHAPTER_DEADLINE_MS) {
        timedOut = true;
        return;
      }
      const index = next++;
      if (index >= urls.length) return;

      const result = await storePage(urls[index]);
      if (!result.ok) {
        failed = true;
        return;
      }
      done += 1;
      bytes += result.bytes;
      if (done % PROGRESS_EVERY === 0) await flush();
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  await flush();

  const error = timedOut ? "tempo esgotado" : failed ? "página não baixou" : null;
  await prisma.chapterDownload
    .update({
      where: { chapterId },
      data: {
        status: error ? "ERROR" : "DONE",
        pagesDone: done,
        bytes,
        error,
      },
    })
    .catch(() => null);

  if (!error) await enforceStorage();
}

let running = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const GATE_RETRY_MS = 60_000;

function scheduleRetry(): void {
  if (retryTimer) return;
  const timer = setTimeout(() => {
    retryTimer = null;
    void runQueue();
  }, GATE_RETRY_MS);
  timer.unref?.();
  retryTimer = timer;
}

export async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  const skipped = new Set<number>();
  try {
    for (;;) {
      const row = await prisma.chapterDownload
        .findFirst({
          where: { status: "QUEUED", chapterId: { notIn: [...skipped] } },
          orderBy: { createdAt: "asc" },
        })
        .catch(() => null);
      if (!row) return;

      await enforceStorage();
      // A closed gate leaves the row QUEUED and comes back later.
      if (!queueGate(await getPolicy(), await freeBytesOnDownloadDisk()).open) {
        scheduleRetry();
        return;
      }

      // The row may have been removed between the pick and now.
      const fresh = await prisma.chapterDownload
        .findUnique({ where: { chapterId: row.chapterId } })
        .catch(() => null);
      if (!fresh || fresh.status !== "QUEUED") {
        skipped.add(row.chapterId);
        continue;
      }

      const claimed = await prisma.chapterDownload
        .update({ where: { chapterId: row.chapterId }, data: { status: "RUNNING", error: null } })
        .catch(() => null);
      if (!claimed) {
        skipped.add(row.chapterId);
        continue;
      }

      try {
        await downloadChapter(row.chapterId);
      } catch (e) {
        await prisma.chapterDownload
          .update({
            where: { chapterId: row.chapterId },
            data: { status: "ERROR", error: String((e as Error)?.message || e).slice(0, 200) },
          })
          .catch(() => null);
      }
    }
  } catch {
    /* the queue never takes the process down */
  } finally {
    running = false;
  }
}

export async function removeDownload(chapterId: number): Promise<boolean> {
  try {
    const row = await prisma.chapterDownload.findUnique({ where: { chapterId } });
    if (!row) return false;
    for (const url of parsePages(row.pages)) {
      const origin = originTargetFor(url);
      if (origin) await deleteDiskImage(origin.target, "download");
    }
    await prisma.chapterDownload.delete({ where: { chapterId } }).catch(() => null);
    return true;
  } catch {
    return false;
  }
}

export async function removeWorkDownloads(workId: number): Promise<number> {
  try {
    const rows = await prisma.chapterDownload.findMany({ where: { workId } });
    let removed = 0;
    for (const row of rows) {
      if (await removeDownload(row.chapterId)) removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

export async function downloadsSnapshot(options?: {
  viewerId?: number | null;
  canEditQuotas?: boolean;
}): Promise<{
  items: DownloadItem[];
  storage: DownloadStorage;
  policy: Policy;
  gate: Gate;
  users: DownloadUserUsage[];
  viewerId: number | null;
  canEditQuotas: boolean;
}> {
  const dir = tierDir("download");
  await mkdir(dir, { recursive: true }).catch(() => {});

  const rows = await prisma.chapterDownload
    .findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
      include: {
        work: { select: { title: true, slug: true } },
        user: { select: { username: true } },
      },
    })
    .catch(() => []);

  const totals = await prisma.chapterDownload
    .findMany({ select: { bytes: true, status: true } })
    .catch(() => []);

  const fs = await statfs(dir).catch(() => null);
  const policy = await getPolicy();
  const gate = queueGate(policy, fs ? Number(fs.bavail) * Number(fs.bsize) : Infinity);

  const accounts = await prisma.user
    .findMany({ select: { id: true, username: true, downloadQuotaMb: true } })
    .catch(() => []);
  type UsageRow = {
    userId: number | null;
    _sum: { bytes: number | null };
    _count: { _all: number };
  };
  const usage = await prisma.chapterDownload
    .groupBy({ by: ["userId"], _sum: { bytes: true }, _count: { _all: true } })
    .catch(() => [] as UsageRow[]);
  const usageById = new Map<number, UsageRow>(
    usage.filter((u) => u.userId !== null).map((u) => [u.userId as number, u]),
  );

  const users: DownloadUserUsage[] = accounts
    .map((account) => {
      const row = usageById.get(account.id);
      const quotaMb = effectiveQuotaMb(account.downloadQuotaMb, policy);
      return {
        userId: account.id,
        username: account.username,
        bytes: row?._sum.bytes ?? 0,
        chapters: row?._count._all ?? 0,
        quotaMb,
        quotaBytes: quotaMb > 0 ? quotaMb * 1024 * 1024 : 0,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  return {
    policy,
    gate,
    users,
    viewerId: options?.viewerId ?? null,
    canEditQuotas: Boolean(options?.canEditQuotas),
    items: rows.map((r) => ({
      chapterId: r.chapterId,
      workId: r.workId,
      workTitle: r.work?.title ?? null,
      workSlug: r.work?.slug ?? null,
      chapterName: r.chapterName,
      chapterNumber: r.chapterNumber,
      status: r.status,
      pageCount: r.pageCount,
      pagesDone: r.pagesDone,
      bytes: r.bytes,
      error: r.error,
      owner: r.user?.username ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
    storage: {
      path: dir,
      downloadsBytes: totals.reduce((acc, r) => acc + r.bytes, 0),
      chapters: totals.filter((r) => r.status === "DONE").length,
      diskTotal: fs ? Number(fs.blocks) * Number(fs.bsize) : 0,
      diskFree: fs ? Number(fs.bavail) * Number(fs.bsize) : 0,
      diskUsed: fs ? (Number(fs.blocks) - Number(fs.bavail)) * Number(fs.bsize) : 0,
      quotaBytes: policy.quotaMb > 0 ? policy.quotaMb * 1024 * 1024 : 0,
    },
  };
}

const globalForDownloads = globalThis as unknown as { downloadWorkerStarted?: boolean };

export function startDownloadWorker(): void {
  if (globalForDownloads.downloadWorkerStarted) return;
  globalForDownloads.downloadWorkerStarted = true;
  void (async () => {
    try {
      // A RUNNING row means the previous process died mid-chapter.
      await prisma.chapterDownload.updateMany({
        where: { status: "RUNNING" },
        data: { status: "QUEUED" },
      });
    } catch {
      /* nothing to recover */
    }
    await runQueue();
  })();
}
