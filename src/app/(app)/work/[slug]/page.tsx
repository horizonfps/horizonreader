import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getWorkWithLinks, resolveSourcesForWork, waitForLinks } from "@/lib/backbone/resolve";
import { getCachedChapters, loadChaptersForLink, revalidateChapters } from "@/lib/chapterCache";
import { buildSourceView } from "@/lib/workChapters";
import { coverProxy } from "@/lib/cards";
import RatingBadge from "@/components/RatingBadge";
import FavoriteButton from "@/components/FavoriteButton";
import RefreshSourcesButton from "@/components/RefreshSourcesButton";
import HorizonPickButton from "@/components/HorizonPickButton";
import ChapterBrowser from "@/components/ChapterBrowser";
import ResolvingSources from "@/components/ResolvingSources";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
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

// Which chapters a link owns, read locally only: picking the source by progress
// must never wait on a source that is slow or down.
async function chapterIdsForLink(link: {
  id: number;
  kind?: string | null;
  sourceId?: string | null;
  sourceMangaId: number;
}): Promise<Set<number>> {
  const hit = await getCachedChapters<{ id: number }[]>(link).catch(() => null);
  if (hit) return new Set(hit.data.map((chapter) => chapter.id));
  if (link.kind !== "scraper") return new Set<number>();
  const chapters = await loadChaptersForLink(link).catch(() => []);
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
    // Refresh the saved lists in the background instead of dropping them: the
    // page must come back filled, not empty waiting on every source again.
    const freshLinks = await prisma.sourceLink.findMany({ where: { workId } }).catch(() => []);
    for (const link of freshLinks) revalidateChapters(link);
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
  // Used only to rank sources by how much of the work is already on disk; the
  // per-chapter download state comes with the source view.
  const workDownloads = await prisma.chapterDownload
    .findMany({ where: { workId, status: "DONE" }, select: { mangaId: true, status: true } })
    .catch(() => []);

  const doneByMangaId = new Map<number, number>();
  for (const row of workDownloads) {
    if (row.status !== "DONE") continue;
    doneByMangaId.set(row.mangaId, (doneByMangaId.get(row.mangaId) ?? 0) + 1);
  }

  const explicitLink = links.find((l) => l.id === selectedId) ?? null;
  let mostDownloadedLink: any | null = null;
  if (!explicitLink && !selectedFromProgress) {
    let best = 0;
    for (const link of links) {
      const done = doneByMangaId.get(link.sourceMangaId) ?? 0;
      if (done > best) {
        best = done;
        mostDownloadedLink = link;
      }
    }
  }
  const selected =
    explicitLink ?? selectedFromProgress ?? mostDownloadedLink ?? links[0] ?? null;

  let wantScan: string | null = null;
  if (scan != null) {
    try {
      wantScan = decodeURIComponent(scan);
    } catch {
      wantScan = scan;
    }
  }

  // null means the source has not answered yet; ChapterBrowser polls for it.
  const view = selected ? await buildSourceView(selected, { uid }) : null;

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm text-muted">Fontes</h2>
          <RefreshSourcesButton workId={work?.id ?? workId} />
        </div>
        {links.length > 0 ? (
          <ChapterBrowser
            slug={slug}
            workId={workId}
            sources={links.map((l) => ({
              id: l.id,
              sourceName: l.sourceName || "Fonte",
              chapterCount: l.chapterCount,
              healthScore: l.healthScore,
              lang: l.lang,
            }))}
            initialSourceId={selected?.id ?? null}
            initialScan={wantScan}
            initialView={view}
          />
        ) : (
          <ResolvingSources />
        )}
      </section>
    </div>
  );
}
