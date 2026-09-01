// Server-side chapter download queue: pulls every page of a chapter into the
// `download` disk tier, which no cache sweep ever evicts. Worker count and
// bandwidth come from the policy; resumable across restarts.

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

const ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const PAGE_TIMEOUT_MS = 20_000;
const CHAPTER_DEADLINE_MS = 10 * 60_000;
const PROGRESS_EVERY = 5;
// Pauses before each extra pass over the pages that failed in a chapter.
const PASS_PAUSE_MS = [10_000, 30_000];
const CHAPTER_ATTEMPTS = 3;
const CHAPTER_RETRY_MS = 5 * 60_000;

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

const SPEED_WINDOW_MS = 10_000;

// Shared token bucket: every worker books the next free slot on one timeline.
let nextSlotAt = 0;

async function spendBandwidth(bytes: number, limitBps: number): Promise<void> {
  if (limitBps <= 0 || bytes <= 0) return;
  const now = Date.now();
  const start = Math.max(nextSlotAt, now);
  nextSlotAt = start + (bytes / limitBps) * 1000;
  const wait = start - now;
  if (wait > 0) await sleep(Math.min(wait, 30_000));
}

// Shared backoff: one page refused by a source pauses every worker, so the
// queue stops feeding a rate limit it already tripped.
let cooldownUntil = 0;
let refusals = 0;

async function waitCooldown(): Promise<void> {
  const wait = cooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

function retryAfterMs(res: Response | null): number {
  const raw = res?.headers.get("retry-after");
  const seconds = Number(raw);
  return raw && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function noteRefusal(res: Response | null): void {
  refusals += 1;
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(refusals - 1, 5));
  cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(backoff, retryAfterMs(res)));
}

function noteSuccess(): void {
  refusals = Math.max(0, refusals - 1);
}

const speedWindow: { at: number; bytes: number }[] = [];

function recordBytes(n: number): void {
  if (n <= 0) return;
  const now = Date.now();
  speedWindow.push({ at: now, bytes: n });
  while (speedWindow.length && now - speedWindow[0].at > SPEED_WINDOW_MS) speedWindow.shift();
}

export function currentSpeedBps(): number {
  const now = Date.now();
  while (speedWindow.length && now - speedWindow[0].at > SPEED_WINDOW_MS) speedWindow.shift();
  if (!speedWindow.length) return 0;
  const total = speedWindow.reduce((acc, s) => acc + s.bytes, 0);
  const span = Math.max(now - speedWindow[0].at, 1000);
  return Math.round((total / span) * 1000);
}

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
  } catch {
    /* housekeeping never breaks the caller */
  }
  return { removed, bytesFreed };
}

// Per-user quota only blocks new downloads; freeing space for an account that
// went over is an explicit admin action, never automatic.
export async function enforceUserQuotas(): Promise<{ removed: number; bytesFreed: number }> {
  let removed = 0;
  let bytesFreed = 0;
  try {
    const policy = await getPolicy();
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
            attempts: 0,
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

// `status` is the last upstream answer, 0 when the request never completed.
type PageResult = { bytes: number; ok: boolean; status: number };

async function storePage(proxiedUrl: string, limitBps: number): Promise<PageResult> {
  const origin = originTargetFor(proxiedUrl);
  if (!origin) return { bytes: 0, ok: false, status: 0 };
  const { target, referer } = origin;

  const already = await getDiskImage(target, "download");
  if (already) return { bytes: already.body.byteLength, ok: true, status: 200 };

  const warm = await getDiskImage(target, "page");
  if (warm) {
    await setDiskImage(target, warm.body, warm.contentType, "download");
    return { bytes: warm.body.byteLength, ok: true, status: 200 };
  }

  let status = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    await waitCooldown();
    const res = await fetch(target, {
      cache: "no-store",
      redirect: "manual",
      headers: referer ? { "User-Agent": UA, Referer: referer } : undefined,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    }).catch(() => null);
    status = res?.status ?? 0;

    if (res && res.status === 200) {
      const body = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (body.byteLength) {
        await setDiskImage(
          target,
          body,
          res.headers.get("content-type") || "application/octet-stream",
          "download",
        );
        noteSuccess();
        recordBytes(body.byteLength);
        await spendBandwidth(body.byteLength, limitBps);
        return { bytes: body.byteLength, ok: true, status };
      }
    } else if (res) {
      await res.body?.cancel().catch(() => {});
      // 4xx other than rate limiting is a real answer; retrying only burns time.
      if (res.status !== 429 && res.status >= 400 && res.status < 500) {
        return { bytes: 0, ok: false, status };
      }
    }
    noteRefusal(res);
    if (attempt < ATTEMPTS - 1) {
      await sleep(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  return { bytes: 0, ok: false, status };
}

// A page that failed is retried in later passes instead of sinking the
// chapter; the chapter only errors when pages are still missing at the end.
async function downloadChapter(chapterId: number, attempts: number): Promise<void> {
  const started = Date.now();
  const policy = await getPolicy();
  const limitBps = Math.max(0, policy.maxKbps) * 1024;
  const pageWorkers = Math.max(1, Math.min(8, policy.parallelPages));

  const urls = await chapterPageUrls(chapterId, Number.MAX_SAFE_INTEGER);
  if (!urls.length) {
    await finishChapter(chapterId, attempts, 0, 0, "sem páginas");
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
  let timedOut = false;
  let lastStatus = 0;
  let pending = urls.map((_, i) => i);

  const flush = () =>
    prisma.chapterDownload
      .update({ where: { chapterId }, data: { pagesDone: done, bytes } })
      .catch(() => null);

  const expired = () => Date.now() - started > CHAPTER_DEADLINE_MS;

  for (let pass = 0; pass <= PASS_PAUSE_MS.length && pending.length; pass++) {
    if (pass > 0) {
      if (expired()) break;
      await sleep(PASS_PAUSE_MS[pass - 1]);
    }
    const queue = pending;
    const failed: number[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (timedOut) return;
        if (expired()) {
          timedOut = true;
          return;
        }
        const slot = next++;
        if (slot >= queue.length) return;
        const index = queue[slot];

        const result = await storePage(urls[index], limitBps);
        if (!result.ok) {
          failed.push(index);
          lastStatus = result.status;
          continue;
        }
        done += 1;
        bytes += result.bytes;
        if (done % PROGRESS_EVERY === 0) await flush();
      }
    };

    await Promise.all(Array.from({ length: Math.min(pageWorkers, queue.length) }, worker));
    pending = [...failed, ...queue.slice(next)].sort((a, b) => a - b);
  }

  const error = !pending.length
    ? null
    : timedOut
      ? "tempo esgotado"
      : `${pending.length} página(s) não baixaram (HTTP ${lastStatus})`;
  await finishChapter(chapterId, attempts, done, bytes, error);
}

// A failed chapter goes back to the queue until it runs out of attempts.
async function finishChapter(
  chapterId: number,
  attempts: number,
  pagesDone: number,
  bytes: number,
  error: string | null,
): Promise<void> {
  const retry = error !== null && attempts + 1 < CHAPTER_ATTEMPTS;
  if (error) {
    console.warn(
      `[download] chapter ${chapterId}: ${error}; attempt ${attempts + 1}/${CHAPTER_ATTEMPTS}${
        retry ? ", retrying" : ""
      }`,
    );
  }
  await prisma.chapterDownload
    .update({
      where: { chapterId },
      data: {
        status: error ? (retry ? "QUEUED" : "ERROR") : "DONE",
        attempts: error ? attempts + 1 : attempts,
        pagesDone,
        bytes,
        error: retry ? null : error,
      },
    })
    .catch(() => null);

  if (!error) await enforceStorage();
}

let active = 0;
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

async function chapterWorker(): Promise<void> {
  try {
    for (;;) {
      // Fresh chapters go first; a chapter that just failed waits its turn
      // before being retried.
      const row = await prisma.chapterDownload
        .findFirst({
          where: {
            status: "QUEUED",
            OR: [{ attempts: 0 }, { updatedAt: { lt: new Date(Date.now() - CHAPTER_RETRY_MS) } }],
          },
          orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => null);
      if (!row) {
        const deferred = await prisma.chapterDownload
          .count({ where: { status: "QUEUED" } })
          .catch(() => 0);
        if (deferred > 0) scheduleRetry();
        return;
      }

      await enforceStorage();
      // A closed gate leaves the row QUEUED and comes back later.
      if (!queueGate(await getPolicy(), await freeBytesOnDownloadDisk()).open) {
        scheduleRetry();
        return;
      }

      // Atomic claim: only one worker can flip the row to RUNNING, and a row
      // that vanished in the meantime updates nothing.
      const claimed = await prisma.chapterDownload
        .updateMany({
          where: { chapterId: row.chapterId, status: "QUEUED" },
          data: { status: "RUNNING", error: null },
        })
        .catch(() => null);
      if (!claimed || claimed.count !== 1) continue;

      try {
        await downloadChapter(row.chapterId, row.attempts);
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
  }
}

export async function runQueue(): Promise<void> {
  const policy = await getPolicy();
  const want = Math.max(1, Math.min(4, policy.parallelChapters));
  while (active < want) {
    active += 1;
    void chapterWorker().finally(() => {
      active -= 1;
    });
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
  speedBps: number;
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
    speedBps: currentSpeedBps(),
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
