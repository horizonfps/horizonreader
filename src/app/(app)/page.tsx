import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getHomeSections } from "@/lib/backbone/sections";
import { getHorizonPicks } from "@/lib/backbone/recommend";
import { attachLocalSlugs } from "@/lib/backbone/localslugs";
import WindowTabs from "@/components/WindowTabs";
import SectionRow from "@/components/SectionRow";
import CardRow from "@/components/CardRow";
import InfiniteGrid from "@/components/InfiniteGrid";
import FavoritesCarousel from "@/components/FavoritesCarousel";

export const dynamic = "force-dynamic";

type HistoryEntry = { slug: string; title: string; coverUrl: string | null };
type FavEntry = { slug: string; title: string; coverUrl: string | null; rating: number | null };

// Most-recent read per work, capped for the "Continuar" strip.
async function getHistory(userId: number): Promise<HistoryEntry[]> {
  try {
    const rows = await prisma.readingHistory.findMany({
      where: { userId },
      orderBy: { readAt: "desc" },
      include: { work: true },
      take: 30,
    });
    const seen = new Set<number>();
    const out: HistoryEntry[] = [];
    for (const r of rows) {
      if (!r.work || seen.has(r.workId)) continue;
      seen.add(r.workId);
      out.push({ slug: r.work.slug, title: r.work.title, coverUrl: r.work.coverUrl });
      if (out.length >= 30) break;
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
      }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) return null;
  const userId = session.uid;

  const [history, favorites, sections, horizonPicks] = await Promise.all([
    getHistory(userId),
    getFavorites(userId),
    getHomeSections().catch(() => null),
    getHorizonPicks(userId),
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

  return (
    <div className="space-y-6">
      {history.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm text-muted">Continuar</h2>
          <CardRow
            items={history.map((h) => ({
              href: `/work/${h.slug}`,
              title: h.title,
              coverUrl: h.coverUrl,
            }))}
          />
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm text-muted">Favoritos</h2>
        {favorites.length > 0 ? (
          <FavoritesCarousel items={favorites} />
        ) : (
          <p className="text-sm text-muted">
            Nada nos favoritos ainda.{" "}
            <Link href="/browse" className="text-accent hover:text-accent-hover">
              Explorar títulos
            </Link>
          </p>
        )}
      </section>

      <SectionRow title="Horizon Recomenda" items={horizonPicks} />

      {popular ? (
        <WindowTabs
          title="Populares"
          tabs={[
            { key: "30d", label: "30d", items: popular["30d"] },
            { key: "6m", label: "6m", items: popular["6m"] },
            { key: "12m", label: "12m", items: popular["12m"] },
            { key: "all", label: "Tudo", items: popular.all },
          ]}
        />
      ) : null}

      <SectionRow title="Best New Comics" items={bestNew} />

      {completed ? (
        <WindowTabs
          title="Recém-completos"
          tabs={[
            { key: "7d", label: "7d", items: completed["7d"] },
            { key: "30d", label: "30d", items: completed["30d"] },
            { key: "12m", label: "12m", items: completed["12m"] },
          ]}
        />
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text">Recém-atualizados</h2>
        <InfiniteGrid endpoint="/api/feed" />
      </section>
    </div>
  );
}
