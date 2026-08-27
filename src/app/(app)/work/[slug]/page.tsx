import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpen, Check } from "lucide-react";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getWorkWithLinks, resolveSourcesForWork, waitForLinks } from "@/lib/backbone/resolve";
import {
  getCachedChapters,
  setCachedChapters,
  bustChapters,
  loadChaptersForLink,
  revalidateChapters,
} from "@/lib/chapterCache";
import { groupByScanlator, dedupeByNumber } from "@/lib/chapters";
import { pickResumeChapter, formatChapterNumber, type ResumeKind } from "@/lib/continueReading";
import { coverProxy } from "@/lib/cards";
import RatingBadge from "@/components/RatingBadge";
import FavoriteButton from "@/components/FavoriteButton";
import RefreshSourcesButton from "@/components/RefreshSourcesButton";
import DownloadButton, { type DownloadStatus } from "@/components/DownloadButton";
import BulkDownloadBar from "@/components/BulkDownloadBar";
import HorizonPickButton from "@/components/HorizonPickButton";
import PrefetchLink from "@/components/PrefetchLink";
import ResolvingSources from "@/components/ResolvingSources";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const RESUME_PREFIX: Record<ResumeKind, string> = {
  start: "Começar a ler",
  resume: "Continuar",
  next: "Continuar",
  reread: "Reler último",
};
// How long a first-time source resolve may block the request before the page
// paints; the resolve keeps running in the background past this budget.
const RESOLVE_BUDGET_MS = 3_500;

function cap(s?: string | null): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseGenres(json?: string | null): string[] {
  if (!json) return [];
  try {
    const g = JSON.parse(json);
    return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

// Suwayomi uploadDate is epoch millis as a string; fall back to Date.parse.
function fmtDate(s?: string | null): string {
  if (!s) return "";
  const n = Number(s);
  const t = Number.isFinite(n) && n > 0 ? n : Date.parse(s);
  if (!Number.isFinite(t) || !t) return "";
  return new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function healthColor(score?: number | null): string {
  const v = score ?? 0;
  if (v >= 55) return "bg-green-500";
  if (v >= 30) return "bg-orange-500";
  return "bg-red-500";
}

async function chapterIdsForLink(link: {
  id: number;
  kind?: string | null;
  sourceId?: string | null;
  sourceMangaId: number;
}): Promise<Set<number>> {
  const chapters = await loadChaptersForLink(link);
  return new Set(chapters.map((chapter) => chapter.id));
}

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; scan?: string; refresh?: string }>;
}) {
  // Route params arrive percent-encoded; legacy non-ASCII slugs need decoding.
  const { slug: rawSlug } = await params;
  let slug = rawSlug;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {}
  const sp = await searchParams;

  const session = await getSession();

  const work = await prisma.work.findUnique({ where: { slug } });
  if (!work) notFound();

  const favStatus = session
    ? (
        await prisma.favorite
          .findUnique({ where: { userId_workId: { userId: session.uid, workId: work.id } } })
          .catch(() => null)
      )?.status ?? null
    : null;

  const isAdmin = session?.isAdmin ?? false;
  const isPicked = isAdmin
    ? !!(await prisma.horizonPick
        .findUnique({ where: { workId: work.id }, select: { id: true } })
        .catch(() => null))
    : false;

  const cover = coverProxy(work.coverUrl);
  const genres = parseGenres(work.genres);
  const meta = [cap(work.type), cap(work.status), work.year].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex gap-4">
        <div className="relative aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-lg bg-surface sm:w-40">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" draggable={false} className="cover-img h-full w-full object-cover" />
          ) : null}
          <RatingBadge rating={work.rating} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-lg font-semibold leading-tight sm:text-2xl">{work.title}</h1>
          {work.author ? <p className="text-sm text-muted">{work.author}</p> : null}
          {meta ? <p className="text-xs text-muted">{meta}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <FavoriteButton workId={work.id} initialStatus={favStatus} />
            {isAdmin ? <HorizonPickButton workId={work.id} initialPicked={isPicked} /> : null}
          </div>
        </div>
      </header>

      {genres.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {genres.map((g) => (
            <span key={g} className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">
              {g}
            </span>
          ))}
        </div>
      ) : null}

      {work.description ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{work.description}</p>
      ) : null}

      <Suspense fallback={<SourcesSkeleton />}>
        <SourcesAndChapters
          slug={slug}
          workId={work.id}
          uid={session?.uid ?? null}
          src={sp.src}
          scan={sp.scan}
          refresh={sp.refresh}
        />
      </Suspense>
    </div>
  );
}

function SourcesSkeleton() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm text-muted">Fontes</h2>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 w-24 animate-pulse rounded-full bg-elevated" />
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm text-muted">Capítulos</h2>
        <div className="mb-3 h-10 w-full animate-pulse rounded-lg bg-elevated" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded bg-elevated/60" />
          ))}
        </div>
      </section>
    </div>
  );
}

// Everything below the fold that depends on the expensive source resolution.
// Streamed in a Suspense boundary so the header renders instantly.
async function SourcesAndChapters({
  slug,
  workId,
  uid,
  src,
  scan,
  refresh,
}: {
  slug: string;
  workId: number;
  uid: number | null;
  src?: string;
  scan?: string;
  refresh?: string;
}) {
  // Force a re-resolve, then strip the param (redirect throws; keep it unwrapped).
  if (refresh) {
    await resolveSourcesForWork(workId, { force: true });
    const freshLinks = await prisma.sourceLink
      .findMany({ where: { workId }, select: { id: true, kind: true, sourceMangaId: true } })
      .catch(() => []);
    await bustChapters(freshLinks);
    redirect(`/work/${slug}${src ? `?src=${src}` : ""}`);
  }

  let data = await getWorkWithLinks(workId);
  const stale =
    !data ||
    data.links.length === 0 ||
    !data.links.some(
      (l) => l.lastSyncedAt && Date.now() - new Date(l.lastSyncedAt).getTime() < DAY_MS,
    );
  if (stale) {
    const resolving = resolveSourcesForWork(workId).catch(() => {});
    if (data?.links.length) {
      // Existing sources still render; refresh them off the request path.
      void resolving;
    } else {
      // First open: release the page the moment the first usable link lands
      // instead of waiting out the sweep. The rest keeps resolving in the
      // background (coalesced) and <ResolvingSources> polls until it shows up.
      await Promise.race([
        resolving,
        waitForLinks(workId, { minLinks: 1, timeoutMs: RESOLVE_BUDGET_MS }),
      ]);
      data = await getWorkWithLinks(workId);
    }
  }

  const work = data?.work ?? null;
  const links: any[] = data?.links ?? [];

  const unfinishedProgress = uid
    ? await prisma.progress
        .findMany({
          where: { userId: uid, workId, read: false, lastPageRead: { gt: 0 } },
          orderBy: { updatedAt: "desc" },
        })
        .catch(() => [])
    : [];

  // An explicit source always wins; otherwise resume the source that owns the chapter.
  const selectedId = src ? Number(src) : null;
  let selectedFromProgress: any | null = null;
  if (!src) {
    const candidates = links.filter((link) =>
      unfinishedProgress.some((progress) => progress.mangaId === link.sourceMangaId),
    );
    const chapterIdsByLink = new Map<number, Set<number>>();
    await Promise.all(
      candidates.map(async (link) => {
        chapterIdsByLink.set(link.id, await chapterIdsForLink(link));
      }),
    );
    for (const progress of unfinishedProgress) {
      const matches = candidates.filter((link) =>
        chapterIdsByLink.get(link.id)?.has(progress.chapterId),
      );
      if (matches.length === 1) {
        selectedFromProgress = matches[0];
        break;
      }
    }
  }
  const selected = links.find((l) => l.id === selectedId) ?? selectedFromProgress ?? links[0] ?? null;

  type ChapterView = {
    id: number;
    name: string;
    chapterNumber: number;
    scanlator?: string | null;
    uploadDate?: string | null;
  };
  let chapters: ChapterView[] = [];
  if (selected) {
    const hit = await getCachedChapters<ChapterView[]>(selected);
    if (hit) {
      chapters = hit.data;
      if (hit.stale) revalidateChapters(selected);
    } else {
      chapters = (await loadChaptersForLink(selected)) as ChapterView[];
      if (chapters.length) await setCachedChapters(selected, chapters);
    }
  }

  // Split the source's chapters by scanlator so a single scan group reads clean.
  // ?scan picks a group; else the largest. dedupeByNumber drops re-uploads so
  // the list (and the reader's next/prev) never repeats a number.
  const groups = selected ? groupByScanlator(chapters) : [];
  let wantScan: string | null = null;
  if (scan != null) {
    try {
      wantScan = decodeURIComponent(scan);
    } catch {
      wantScan = scan;
    }
  }
  const activeGroup =
    (wantScan != null ? groups.find((g) => g.key === wantScan) : undefined) ?? groups[0];
  const visible: ChapterView[] = activeGroup
    ? dedupeByNumber(activeGroup.chapters).sort((a, b) => b.chapterNumber - a.chapterNumber)
    : [];

  const visibleChapterIds = new Set(visible.map((chapter) => chapter.id));

  const downloadRows = visibleChapterIds.size
    ? await prisma.chapterDownload
        .findMany({
          where: { chapterId: { in: [...visibleChapterIds] } },
          select: { chapterId: true, status: true },
        })
        .catch(() => [])
    : [];
  const downloadStatusByChapter = new Map<number, DownloadStatus>(
    downloadRows.map((row) => [row.chapterId, row.status as DownloadStatus]),
  );

  const progressList =
    uid && selected
      ? (
          await prisma.progress
            .findMany({ where: { userId: uid, mangaId: selected.sourceMangaId } })
            .catch(() => [])
        ).filter((progress) => visibleChapterIds.has(progress.chapterId))
      : [];

  const readSet = new Set(progressList.filter((p) => p.read).map((p) => p.chapterId));

  // Reading entry point: the furthest point reached, never a skipped chapter.
  const chaptersAsc = [...visible].reverse();
  const resume = pickResumeChapter(chaptersAsc, progressList);
  const startId = resume?.chapterId ?? null;
  const startLabel = resume
    ? `${RESUME_PREFIX[resume.kind]} · Cap. ${formatChapterNumber(resume.chapterNumber)}`
    : "";

  // Shortcut payload: the resume target plus the four chapters after it.
  const resumeIndex = resume ? chaptersAsc.findIndex((c) => c.id === resume.chapterId) : -1;
  const nextChapters =
    resumeIndex >= 0
      ? chaptersAsc
          .slice(resumeIndex, resumeIndex + 5)
          .map((c) => ({ chapterId: c.id, name: c.name, number: c.chapterNumber }))
      : [];

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm text-muted">Fontes</h2>
          <RefreshSourcesButton workId={work?.id ?? workId} />
        </div>
        {links.length > 0 ? (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {links.map((link) => {
              const active = selected?.id === link.id;
              return (
                <PrefetchLink
                  key={link.id}
                  href={`/work/${slug}?src=${link.id}`}
                  scroll={false}
                  className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs ${
                    active ? "bg-accent text-on-accent" : "bg-elevated text-text"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${healthColor(link.healthScore)}`} />
                  <span className="max-w-[10rem] truncate">{link.sourceName || "Fonte"}</span>
                  <span className={active ? "text-on-accent" : "text-muted"}>{link.chapterCount}</span>
                </PrefetchLink>
              );
            })}
          </div>
        ) : (
          <ResolvingSources />
        )}
      </section>

      {groups.length > 1 && selected ? (
        <section>
          <h2 className="mb-2 text-sm text-muted">Grupos de scan</h2>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {groups.map((g) => {
              const active = activeGroup?.key === g.key;
              return (
                <Link
                  key={g.key || "—"}
                  href={`/work/${slug}?src=${selected.id}&scan=${encodeURIComponent(g.key)}`}
                  scroll={false}
                  className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs ${
                    active ? "bg-accent text-on-accent" : "bg-elevated text-text"
                  }`}
                >
                  <span className="max-w-[10rem] truncate">{g.key || "Sem grupo"}</span>
                  <span className={active ? "text-on-accent" : "text-muted"}>{g.count}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm text-muted">
          Capítulos{visible.length ? ` (${visible.length})` : ""}
        </h2>

        {startId ? (
          <div className="mb-3 flex gap-2">
            <Link
              href={`/reader/${startId}`}
              className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              <BookOpen className="h-4 w-4" />
              {startLabel}
            </Link>
            {selected && nextChapters.length > 0 ? (
              <DownloadButton
                label="Baixar 5 próximos"
                chapters={nextChapters}
                mangaId={selected.sourceMangaId}
                workId={workId}
              />
            ) : null}
          </div>
        ) : null}

        {selected && visible.length > 0 ? (
          <BulkDownloadBar
            chapters={chaptersAsc.map((c) => ({
              chapterId: c.id,
              name: c.name,
              number: c.chapterNumber,
            }))}
            mangaId={selected.sourceMangaId}
            workId={workId}
          />
        ) : null}

        {visible.length === 0 ? (
          <p className="text-sm text-muted">
            {selected
              ? links.length > 1
                ? "Esta fonte não tem capítulos. Tente outra fonte acima."
                : "Esta fonte ainda não tem capítulos."
              : "Selecione uma fonte para ver os capítulos."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((c) => {
              const read = readSet.has(c.id);
              const sub = fmtDate(c.uploadDate);
              return (
                <li key={c.id} className="flex items-center gap-2">
                  <Link
                    href={`/reader/${c.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${read ? "text-muted" : "text-text"}`}>{c.name}</p>
                      {sub ? <p className="truncate text-xs text-muted">{sub}</p> : null}
                    </div>
                    {read ? <Check className="h-4 w-4 shrink-0 text-muted" /> : null}
                  </Link>
                  {selected ? (
                    <DownloadButton
                      chapters={[{ chapterId: c.id, name: c.name, number: c.chapterNumber }]}
                      mangaId={selected.sourceMangaId}
                      workId={workId}
                      initialStatus={downloadStatusByChapter.get(c.id) ?? null}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
