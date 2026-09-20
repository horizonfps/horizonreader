import Link from "next/link";
import { User as UserIcon } from "lucide-react";
import type { Favorite, Work, ReadingHistory } from "@prisma/client";
import { coverProxy, STATUS_ORDER, STATUS_LABELS } from "@/lib/cards";
import { timeAgo, typeLabel } from "@/lib/labels";
import { formatChapterNumber } from "@/lib/continueReading";
import Username from "@/components/Username";
import AdminBadge from "@/components/AdminBadge";
import MangaCard from "@/components/MangaCard";
import SectionHeader from "@/components/SectionHeader";

type FavWithWork = Favorite & { work: Work | null };
type HistoryWithWork = ReadingHistory & { work: Work | null };

export type ProfileUser = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  isAdmin: boolean;
  createdAt?: Date | null;
};

export type ProfileStats = {
  chaptersRead: number;
};

// Read-only profile body shared by the own-profile page and public /u/[username].
// `actions` injects the owner-only edit/export controls.
export default function ProfileView({
  user,
  favorites,
  history,
  stats,
  actions,
}: {
  user: ProfileUser;
  favorites: FavWithWork[];
  history: HistoryWithWork[];
  stats?: ProfileStats;
  actions?: React.ReactNode;
}) {
  const displayName = user.displayName || user.username;

  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const genreCounts = new Map<string, number>();
  const byStatus = new Map<string, FavWithWork[]>();

  for (const fav of favorites) {
    statusCounts[fav.status] = (statusCounts[fav.status] ?? 0) + 1;
    const bucket = byStatus.get(fav.status) ?? [];
    bucket.push(fav);
    byStatus.set(fav.status, bucket);

    const w = fav.work;
    if (!w) continue;
    if (w.type) typeCounts[w.type] = (typeCounts[w.type] ?? 0) + 1;
    if (w.genres) {
      try {
        const parsed = JSON.parse(w.genres);
        if (Array.isArray(parsed)) {
          for (const g of parsed) {
            if (typeof g === "string" && g.trim()) {
              genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
            }
          }
        }
      } catch {
        // ignore malformed genres JSON
      }
    }
  }

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const bannerSrc = user.bannerUrl ? coverProxy(user.bannerUrl) : "";
  const avatarSrc = user.avatarUrl ? coverProxy(user.avatarUrl) : "";
  const now = Date.now();

  const seenHistory = new Set<number>();
  const recent = history.filter((h) => {
    if (!h.work || seenHistory.has(h.workId)) return false;
    seenHistory.add(h.workId);
    return true;
  });

  const tiles: { label: string; value: string }[] = [
    { label: "na biblioteca", value: String(favorites.length) },
    { label: "capítulos lidos", value: String(stats?.chaptersRead ?? 0) },
    { label: "concluídas", value: String(statusCounts.COMPLETED ?? 0) },
  ];

  return (
    <div className="space-y-8">
      <section className="-mx-4 sm:mx-0">
        <div
          className="relative aspect-[3/1] w-full bg-elevated bg-cover bg-center sm:aspect-[4/1] sm:rounded-2xl"
          style={bannerSrc ? { backgroundImage: `url("${bannerSrc}")` } : undefined}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-bg/90 to-transparent sm:rounded-2xl" />
        </div>
        <div className="relative -mt-12 flex flex-col gap-4 px-4 sm:-mt-14 sm:flex-row sm:items-end sm:px-6">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border-4 border-bg bg-surface sm:h-32 sm:w-32">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted">
                <UserIcon className="h-10 w-10" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 sm:pb-2">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight text-text">
                <Username name={displayName} isAdmin={user.isAdmin} />
              </h1>
              {user.isAdmin ? <AdminBadge /> : null}
            </div>
            <p className="text-sm text-muted">
              @{user.username}
              {user.createdAt ? ` · desde ${user.createdAt.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}` : ""}
            </p>
            {user.bio ? (
              <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-text/85">{user.bio}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2 sm:pb-2">{actions}</div> : null}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2 sm:max-w-md">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface/60 px-3 py-2.5">
            <p className="text-xl font-semibold tabular-nums text-text">{t.value}</p>
            <p className="text-[11px] text-muted">{t.label}</p>
          </div>
        ))}
      </section>

      {favorites.length > 0 ? (
        <section className="flex flex-wrap gap-1.5">
          {Object.keys(typeCounts).map((t) => (
            <span key={t} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-text">
              {typeLabel(t)} <span className="text-muted">{typeCounts[t]}</span>
            </span>
          ))}
          {topGenres.map(([g, n]) => (
            <span key={g} className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">
              {g} <span className="opacity-70">{n}</span>
            </span>
          ))}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section>
          <SectionHeader title="Lidos recentemente" />
          <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
            {recent.slice(0, 12).map((h) => {
              const w = h.work!;
              const src = coverProxy(w.coverUrl);
              return (
                <li key={h.id}>
                  <Link
                    href={`/work/${w.slug}`}
                    className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-elevated">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" loading="lazy" className="cover-img h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text">{w.title}</p>
                      <p className="text-xs text-muted">
                        {h.chapterNumber > 0 ? `Cap. ${formatChapterNumber(h.chapterNumber)} · ` : ""}
                        {timeAgo(h.readAt, now)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {STATUS_ORDER.map((status) => {
        const list = byStatus.get(status);
        if (!list || list.length === 0) return null;
        return (
          <section key={status}>
            <SectionHeader title={`${STATUS_LABELS[status]} · ${list.length}`} />
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8">
              {list.map((fav) =>
                fav.work ? (
                  <MangaCard
                    key={fav.id}
                    href={`/work/${fav.work.slug}`}
                    item={{
                      origin: "mangadex",
                      externalId: "",
                      localSlug: fav.work.slug,
                      title: fav.work.title,
                      coverUrl: fav.work.coverUrl,
                      rating: fav.work.rating,
                      type: (fav.work.type as "manga" | "manhwa" | "manhua" | "other" | null) ?? null,
                    }}
                  />
                ) : null,
              )}
            </div>
          </section>
        );
      })}

      {favorites.length === 0 && recent.length === 0 ? (
        <p className="text-sm text-muted">Nada na biblioteca ainda.</p>
      ) : null}
    </div>
  );
}
