import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpen, Check } from "lucide-react";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getWorkWithLinks, resolveSourcesForWork } from "@/lib/backbone/resolve";
import { getMangaEnsured, getChapters } from "@/lib/suwayomi";
import { getNativeChapters } from "@/lib/scrapers/native";
import {
  chapterCacheKey,
  getCachedChapters,
  setCachedChapters,
  bustChapters,
} from "@/lib/chapterCache";
import { coverProxy } from "@/lib/cards";
import RatingBadge from "@/components/RatingBadge";
import FavoriteButton from "@/components/FavoriteButton";
import RefreshSourcesButton from "@/components/RefreshSourcesButton";
import HorizonPickButton from "@/components/HorizonPickButton";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

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

export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; refresh?: string }>;
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
    <div className="space-y-6">
      <header className="flex gap-4">
        <div className="relative aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-lg bg-surface">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" draggable={false} className="cover-img h-full w-full object-cover" />
          ) : null}
          <RatingBadge rating={work.rating} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-lg font-semibold leading-tight">{work.title}</h1>
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
  refresh,
}: {
  slug: string;
  workId: number;
  uid: number | null;
  src?: string;
  refresh?: string;
}) {
  // Force a re-resolve, then strip the param (redirect throws; keep it unwrapped).
  if (refresh) {
    await resolveSourcesForWork(workId, { force: true });
    const freshLinks = await prisma.sourceLink
      .findMany({ where: { workId }, select: { id: true, kind: true, sourceMangaId: true } })
      .catch(() => []);
    bustChapters(freshLinks.map(chapterCacheKey));
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
    if (data?.links.length) {
      // Existing sources still render; refresh them off the request path.
      void resolveSourcesForWork(workId).catch(() => {});
    } else {
      await resolveSourcesForWork(workId);
      data = await getWorkWithLinks(workId);
    }
  }

  const work = data?.work ?? null;
  const links: any[] = data?.links ?? [];

  // Source selection: ?src picks a link, else the ranked primary/first.
  const selectedId = src ? Number(src) : null;
  const selected = links.find((l) => l.id === selectedId) ?? links[0] ?? null;

  type ChapterView = {
    id: number;
    name: string;
    chapterNumber: number;
    scanlator?: string | null;
    uploadDate?: string | null;
  };
  let chapters: ChapterView[] = [];
  if (selected) {
    const key = chapterCacheKey(selected);
    chapters = getCachedChapters<ChapterView[]>(key) ?? [];
    if (!chapters.length) {
      if (selected.kind === "scraper") {
        chapters = await getNativeChapters(selected.id).catch(() => []);
      } else {
        // A link that already carries chapters was initialized by the sync.
        if (!selected.chapterCount) await getMangaEnsured(selected.sourceMangaId).catch(() => null);
        chapters = await getChapters(selected.sourceMangaId).catch(() => []);
      }
      if (chapters.length) setCachedChapters(key, chapters);
    }
  }

  const progressList =
    uid && selected
      ? await prisma.progress
          .findMany({ where: { userId: uid, mangaId: selected.sourceMangaId } })
          .catch(() => [])
      : [];

  const chapterIds = new Set(chapters.map((c) => c.id));
  const readSet = new Set(progressList.filter((p) => p.read).map((p) => p.chapterId));

  // Reading entry point: resume the in-progress chapter, else first unread.
  const chaptersAsc = [...chapters].reverse();
  let startId: number | null = null;
  let startLabel = "Começar a ler";
  if (chapters.length) {
    const inProgress = progressList
      .filter((p) => !p.read && p.lastPageRead > 0)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (inProgress && chapterIds.has(inProgress.chapterId)) {
      startId = inProgress.chapterId;
      startLabel = "Continuar";
    } else {
      const firstUnread = chaptersAsc.find((c) => !readSet.has(c.id));
      startId = (firstUnread ?? chaptersAsc[0]).id;
      startLabel = readSet.size > 0 ? "Continuar" : "Começar a ler";
    }
  }

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
                <Link
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
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Nenhuma fonte encontrada ainda. Toque em Atualizar fontes para procurar.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm text-muted">
          Capítulos{chapters.length ? ` (${chapters.length})` : ""}
        </h2>

        {startId ? (
          <Link
            href={`/reader/${startId}`}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            <BookOpen className="h-4 w-4" />
            {startLabel}
          </Link>
        ) : null}

        {chapters.length === 0 ? (
          <p className="text-sm text-muted">
            {selected
              ? links.length > 1
                ? "Esta fonte não tem capítulos. Tente outra fonte acima."
                : "Esta fonte ainda não tem capítulos."
              : "Selecione uma fonte para ver os capítulos."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {chapters.map((c) => {
              const read = readSet.has(c.id);
              const sub = [c.scanlator, fmtDate(c.uploadDate)].filter(Boolean).join(" · ");
              return (
                <li key={c.id}>
                  <Link href={`/reader/${c.id}`} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${read ? "text-muted" : "text-text"}`}>{c.name}</p>
                      {sub ? <p className="truncate text-xs text-muted">{sub}</p> : null}
                    </div>
                    {read ? <Check className="h-4 w-4 shrink-0 text-muted" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
