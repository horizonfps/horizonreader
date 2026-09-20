import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getHomeSections } from "@/lib/backbone/sections";
import { getHorizonPicks } from "@/lib/backbone/recommend";
import { getLatestUpdates } from "@/lib/backbone/latest";
import { attachLocalSlugs } from "@/lib/backbone/localslugs";
import { indexComickItems } from "@/lib/backbone/prewarm";
import { formatChapterNumber } from "@/lib/continueReading";
import { timeAgo } from "@/lib/labels";
import type { SectionItem } from "@/lib/backbone/types";
import WindowTabs from "@/components/WindowTabs";
import SectionRow from "@/components/SectionRow";
import SectionHeader from "@/components/SectionHeader";
import CardRow from "@/components/CardRow";
import InfiniteGrid from "@/components/InfiniteGrid";
import HeroCarousel, { type HeroItem } from "@/components/HeroCarousel";
import LatestUpdates from "@/components/LatestUpdates";

export const dynamic = "force-dynamic";

const HERO_MAX = 8;

type HistoryEntry = {
  workId: number;
  title: string;
  coverUrl: string | null;
  chapterNumber: number;
  updatedAt: Date;
};
type FavEntry = { slug: string; title: string; coverUrl: string | null; rating: number | null; type: string | null };

// Most-recently touched works, finished chapters included: where the reading
// resumes is decided by /continue/<workId>, not by the row picked here.
async function getHistory(userId: number): Promise<HistoryEntry[]> {
  try {
    const rows = await prisma.progress.findMany({
      where: { userId, workId: { not: null } },
      orderBy: { updatedAt: "desc" },
      include: { work: true },
      take: 60,
    });
    const seen = new Set<number>();
    const out: HistoryEntry[] = [];
    for (const r of rows) {
      if (!r.work || r.workId === null || seen.has(r.workId)) continue;
      seen.add(r.workId);
      out.push({
        workId: r.workId,
        title: r.work.title,
        coverUrl: r.work.coverUrl,
        chapterNumber: r.chapterNumber,
        updatedAt: r.updatedAt,
      });
      if (out.length >= 20) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function getFavorites(userId: number): Promise<FavEntry[]> {
  try {
    const rows = await prisma.favorite.findMany({
      where: { userId },
      include: { work: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return rows
      .filter((f) => f.work)
      .map((f) => ({
        slug: f.work.slug,
        title: f.work.title,
        coverUrl: f.work.coverUrl,
        rating: f.work.rating,
        type: f.work.type,
      }));
  } catch {
    return [];
  }
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

// Curated picks first, then popular works already in the catalog, so every
// slide has a description and opens without the resolver hop.
async function getHeroItems(picks: SectionItem[], popular: SectionItem[]): Promise<HeroItem[]> {
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const it of [...picks, ...popular]) {
    if (!it.localSlug || seen.has(it.localSlug)) continue;
    seen.add(it.localSlug);
    slugs.push(it.localSlug);
    if (slugs.length >= HERO_MAX * 2) break;
  }
  if (!slugs.length) return [];
  const works = await prisma.work
    .findMany({ where: { slug: { in: slugs } } })
    .catch(() => []);
  const bySlug = new Map(works.map((w) => [w.slug, w]));
  const out: HeroItem[] = [];
  for (const slug of slugs) {
    const w = bySlug.get(slug);
    if (!w || !w.coverUrl) continue;
    out.push({
      href: `/work/${w.slug}`,
      title: w.title,
      coverUrl: w.coverUrl,
      description: w.description,
      genres: parseGenres(w.genres),
      rating: w.rating,
      type: w.type,
      status: w.status,
      year: w.year,
    });
    if (out.length >= HERO_MAX) break;
  }
  return out;
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) return null;
  const userId = session.uid;

  const [history, favorites, sections, horizonPicks, latest] = await Promise.all([
    getHistory(userId),
    getFavorites(userId),
    getHomeSections().catch(() => null),
    getHorizonPicks(),
    getLatestUpdates().catch(() => []),
  ]);

  const popular = sections?.popular;
  const completed = sections?.completed;
  const bestNew = sections?.bestNew ?? [];

  await attachLocalSlugs([
    horizonPicks,
    ...(popular ? [popular["30d"], popular["6m"], popular["12m"], popular.all] : []),
    ...(completed ? [completed["7d"], completed["30d"], completed["12m"]] : []),
    bestNew,
  ]);

  // Order matters: attachLocalSlugs first, since a known localSlug is exactly
  // what does not need indexing.
  indexComickItems([
    ...horizonPicks,
    ...(popular ? [...popular["30d"], ...popular["6m"], ...popular["12m"], ...popular.all] : []),
    ...(completed ? [...completed["7d"], ...completed["30d"], ...completed["12m"]] : []),
    ...bestNew,
  ]);

  const hero = await getHeroItems(horizonPicks, popular?.["30d"] ?? []);
  const now = Date.now();

  return (
    <div className="space-y-8">
      <HeroCarousel items={hero} />

      {history.length > 0 ? (
        <section>
          <SectionHeader title="Continuar lendo" />
          <CardRow
            prefetch={false}
            items={history.map((h) => ({
              href: `/continue/${h.workId}`,
              title: h.title,
              coverUrl: h.coverUrl,
              caption: [
                h.chapterNumber > 0 ? `Cap. ${formatChapterNumber(h.chapterNumber)}` : "",
                timeAgo(h.updatedAt, now),
              ]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        </section>
      ) : null}

      {favorites.length > 0 ? (
        <section>
          <SectionHeader title="Sua biblioteca" href="/library" />
          <CardRow
            items={favorites.map((f) => ({
              href: `/work/${f.slug}`,
              title: f.title,
              coverUrl: f.coverUrl,
              rating: f.rating,
              type: f.type,
            }))}
          />
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">
          Sua biblioteca está vazia.{" "}
          <Link href="/browse" className="text-accent hover:text-accent-hover">
            Explorar títulos
          </Link>
        </section>
      )}

      {latest.length > 0 ? (
        <section>
          <SectionHeader title="Últimas atualizações" href="/browse?sort=latest" />
          <LatestUpdates updates={latest} now={now} />
        </section>
      ) : null}

      <SectionRow title="Horizon Recomenda" items={horizonPicks} />

      {popular ? (
        <WindowTabs
          title="Populares"
          href="/browse?sort=popular"
          tabs={[
            { key: "30d", label: "30 dias", items: popular["30d"] },
            { key: "6m", label: "6 meses", items: popular["6m"] },
            { key: "12m", label: "12 meses", items: popular["12m"] },
            { key: "all", label: "Sempre", items: popular.all },
          ]}
        />
      ) : null}

      <SectionRow title="Novidades em alta" items={bestNew} href="/browse?sort=new" />

      {completed ? (
        <WindowTabs
          title="Recém-completos"
          tabs={[
            { key: "7d", label: "7 dias", items: completed["7d"] },
            { key: "30d", label: "30 dias", items: completed["30d"] },
            { key: "12m", label: "12 meses", items: completed["12m"] },
          ]}
        />
      ) : null}

      <section>
        <SectionHeader title="Adicionados recentemente" href="/browse?sort=new" />
        <InfiniteGrid endpoint="/api/browse?sort=new" />
      </section>
    </div>
  );
}
