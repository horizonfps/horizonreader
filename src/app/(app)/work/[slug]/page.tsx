import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Star, Users, BookOpen } from "lucide-react";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getWorkWithLinks, resolveSourcesForWork, waitForLinks } from "@/lib/backbone/resolve";
import { getCachedChapters, loadChaptersForLink, revalidateChapters } from "@/lib/chapterCache";
import { buildSourceView } from "@/lib/workChapters";
import { getRelatedWorks } from "@/lib/related";
import { coverProxy } from "@/lib/cards";
import { typeLabel, statusLabel, formatCount } from "@/lib/labels";
import { stripMarkdown } from "@/lib/text";
import FavoriteButton from "@/components/FavoriteButton";
import RefreshSourcesButton from "@/components/RefreshSourcesButton";
import HorizonPickButton from "@/components/HorizonPickButton";
import ChapterBrowser from "@/components/ChapterBrowser";
import ResolvingSources from "@/components/ResolvingSources";
import Description from "@/components/Description";
import SectionRow from "@/components/SectionRow";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
// How long a first-time source resolve may block the request before the page
// paints; the resolve keeps running in the background past this budget.
const RESOLVE_BUDGET_MS = 3_500;

const CJK = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;

function parseArr(json?: string | null): string[] {
  if (!json) return [];
  try {
    const g = JSON.parse(json);
    return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function altTitle(title: string, alts: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const t = norm(title);
  for (const a of alts) if (a && norm(a) !== t && !CJK.test(a)) return a;
  return null;
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const work = await prisma.work
    .findUnique({ where: { slug: decodeSlug(slug) }, select: { title: true } })
    .catch(() => null);
  return { title: work?.title ?? "Obra" };
}

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; scan?: string; refresh?: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeSlug(rawSlug);
  const sp = await searchParams;

  const session = await getSession();

  const work = await prisma.work.findUnique({ where: { slug } });
  if (!work) notFound();

  const [favRow, pickRow, linkAgg] = await Promise.all([
    session
      ? prisma.favorite
          .findUnique({ where: { userId_workId: { userId: session.uid, workId: work.id } } })
          .catch(() => null)
      : null,
    session?.isAdmin
      ? prisma.horizonPick
          .findUnique({ where: { workId: work.id }, select: { id: true } })
          .catch(() => null)
      : null,
    prisma.sourceLink
      .aggregate({ where: { workId: work.id }, _max: { chapterCount: true }, _count: { id: true } })
      .catch(() => null),
  ]);

  const favStatus = favRow?.status ?? null;
  const isAdmin = session?.isAdmin ?? false;
  const isPicked = !!pickRow;

  const cover = coverProxy(work.coverUrl);
  const genres = parseArr(work.genres);
  const alt = altTitle(work.title, parseArr(work.altTitles));
  const description = stripMarkdown(work.description);
  const people = [work.author, work.artist && work.artist !== work.author ? work.artist : null]
    .filter(Boolean)
    .join(" · ");
  const maxChapters = linkAgg?._max.chapterCount ?? 0;
  const sourceCount = linkAgg?._count.id ?? 0;

  const details: [string, string][] = [];
  if (work.author) details.push(["Autor", work.author]);
  if (work.artist && work.artist !== work.author) details.push(["Arte", work.artist]);
  if (work.type) details.push(["Formato", typeLabel(work.type)]);
  if (work.status) details.push(["Status", statusLabel(work.status) || work.status]);
  if (work.year) details.push(["Ano", String(work.year)]);
  if (work.follows) details.push(["Seguidores", formatCount(work.follows)]);
  if (sourceCount) details.push(["Fontes", String(sourceCount)]);

  return (
    <div className="relative">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-64 overflow-hidden sm:h-80 lg:h-96">
        <div className="absolute -inset-x-4 -top-4 bottom-0 lg:-inset-x-8">
          {cover ? (
            <div
              className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
              style={{ backgroundImage: `url("${cover}")`, opacity: 0.45 }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-b from-bg/30 via-bg/70 to-bg" />
        </div>
      </div>

      <header className="pt-4 sm:pt-8 lg:pt-12">
        <div className="flex gap-4 sm:gap-6 lg:gap-8">
          <div className="w-28 shrink-0 sm:w-44 lg:w-56">
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface shadow-2xl shadow-black/60 ring-1 ring-white/10">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt=""
                  draggable={false}
                  fetchPriority="high"
                  className="cover-img h-full w-full object-cover"
                />
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-end">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-text sm:text-4xl lg:text-5xl">
              {work.title}
            </h1>
            {alt ? <p className="mt-1 truncate text-sm text-muted sm:text-base">{alt}</p> : null}
            {people ? <p className="mt-1 text-sm text-text/80">{people}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:text-sm">
              {work.rating != null ? (
                <span className="flex items-center gap-1 font-medium text-text">
                  <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                  {work.rating.toFixed(1)}
                </span>
              ) : null}
              {work.follows ? (
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {formatCount(work.follows)}
                </span>
              ) : null}
              {maxChapters ? (
                <span className="flex items-center gap-1">
                  <BookOpen className="h-3.5 w-3.5" />
                  {maxChapters} caps.
                </span>
              ) : null}
              {work.status ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    work.status === "ongoing"
                      ? "bg-green-500/15 text-green-400"
                      : work.status === "completed"
                        ? "bg-accent/15 text-accent"
                        : "bg-elevated text-muted"
                  }`}
                >
                  {statusLabel(work.status) || work.status}
                </span>
              ) : null}
              {[typeLabel(work.type), work.year].filter(Boolean).length ? (
                <span>{[typeLabel(work.type), work.year].filter(Boolean).join(" · ")}</span>
              ) : null}
            </div>
            <div className="mt-3 hidden flex-wrap gap-2 sm:flex">
              <FavoriteButton workId={work.id} initialStatus={favStatus} />
              {isAdmin ? <HorizonPickButton workId={work.id} initialPicked={isPicked} /> : null}
              <RefreshSourcesButton workId={work.id} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
          <FavoriteButton workId={work.id} initialStatus={favStatus} />
          {isAdmin ? <HorizonPickButton workId={work.id} initialPicked={isPicked} /> : null}
          <RefreshSourcesButton workId={work.id} />
        </div>
        {genres.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {genres.map((g) => (
              <Link
                key={g}
                href={`/browse?genre=${encodeURIComponent(g.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`}
                className="rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text/80 hover:bg-accent/15 hover:text-accent"
              >
                {g}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mt-6 flex flex-col gap-6 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        <aside className="order-3 space-y-5 lg:order-none lg:row-span-2">
          {details.length ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {details.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 truncate text-text">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </aside>

        {description ? (
          <div className="order-1 lg:order-none">
            <Description text={description} />
          </div>
        ) : null}

        <div className="order-2 lg:order-none">
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
      </div>

      <Suspense fallback={null}>
        <Related work={{ id: work.id, type: work.type, genres: work.genres }} />
      </Suspense>
    </div>
  );
}

async function Related({ work }: { work: { id: number; type: string | null; genres: string | null } }) {
  const items = await getRelatedWorks(work);
  if (!items.length) return null;
  return (
    <div className="mt-10">
      <SectionRow title="Semelhantes" items={items} />
    </div>
  );
}

function SourcesSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="h-9 w-56 animate-pulse rounded-lg bg-elevated" />
        <div className="ml-auto h-9 w-40 animate-pulse rounded-lg bg-elevated" />
      </div>
      <div className="h-10 w-48 animate-pulse rounded-lg bg-elevated" />
      <div className="space-y-1.5">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-11 w-full animate-pulse rounded-lg bg-elevated/60" />
        ))}
      </div>
    </div>
  );
}

// Everything that depends on the expensive source resolution, streamed in a
// Suspense boundary so the header renders instantly.
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

  if (!links.length) return <ResolvingSources />;

  return (
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
  );
}
