import Link from "next/link";
import { User as UserIcon, Star } from "lucide-react";
import type { Favorite, Work, ReadingHistory } from "@prisma/client";
import { coverProxy, STATUS_ORDER, STATUS_LABELS } from "@/lib/cards";
import Username from "@/components/Username";
import AdminBadge from "@/components/AdminBadge";

type FavWithWork = Favorite & { work: Work | null };
type HistoryWithWork = ReadingHistory & { work: Work | null };

export type ProfileUser = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  isAdmin: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  manga: "Manga",
  manhwa: "Manhwa",
  manhua: "Manhua",
};

type CoverWork = { slug: string; title: string; coverUrl: string | null; rating: number | null };

function WorkCover({ work }: { work: CoverWork }) {
  const src = coverProxy(work.coverUrl);
  return (
    <Link href={`/work/${work.slug}`} className="block">
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            loading="lazy"
            draggable={false}
            className="cover-img h-full w-full object-cover"
          />
        ) : null}
        {work.rating != null ? (
          <span className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-text backdrop-blur">
            <Star className="h-3 w-3 fill-accent text-accent" />
            {work.rating.toFixed(1)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-tight text-text">{work.title}</p>
    </Link>
  );
}

// Read-only profile body shared by the own-profile page and public /u/[username].
// `actions` injects the owner-only edit/export controls.
export default function ProfileView({
  user,
  favorites,
  history,
  actions,
}: {
  user: ProfileUser;
  favorites: FavWithWork[];
  history: HistoryWithWork[];
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
    .slice(0, 15)
    .map(([g]) => g);

  const bannerSrc = user.bannerUrl ? coverProxy(user.bannerUrl) : "";
  const avatarSrc = user.avatarUrl ? coverProxy(user.avatarUrl) : "";

  return (
    <div className="space-y-6">
      <section>
        <div
          className="aspect-[5/2] w-full rounded-xl bg-elevated bg-cover bg-center"
          style={bannerSrc ? { backgroundImage: `url("${bannerSrc}")` } : undefined}
        />
        <div className="-mt-12 h-28 w-28 overflow-hidden rounded-full border-4 border-bg bg-surface sm:h-32 sm:w-32">
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">
              <UserIcon className="h-10 w-10" />
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-text">
            <Username name={displayName} isAdmin={user.isAdmin} />
          </h1>
          {user.isAdmin ? <AdminBadge /> : null}
        </div>
        {user.bio ? (
          <p className="mt-1 whitespace-pre-line text-sm text-muted">{user.bio}</p>
        ) : null}
      </section>

      {actions ? <section className="space-y-3">{actions}</section> : null}

      {favorites.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {STATUS_ORDER.map((s) =>
              statusCounts[s] ? (
                <span
                  key={s}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text"
                >
                  {STATUS_LABELS[s]} <span className="text-muted">{statusCounts[s]}</span>
                </span>
              ) : null
            )}
            {Object.keys(TYPE_LABELS).map((t) =>
              typeCounts[t] ? (
                <span
                  key={t}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-text"
                >
                  {TYPE_LABELS[t]} <span className="text-muted">{typeCounts[t]}</span>
                </span>
              ) : null
            )}
          </div>
          {topGenres.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topGenres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] text-accent"
                >
                  {g}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <p className="text-sm text-muted">Nenhum favorito ainda.</p>
      )}

      {STATUS_ORDER.map((status) => {
        const list = byStatus.get(status);
        if (!list || list.length === 0) return null;
        return (
          <section key={status} className="space-y-3">
            <h2 className="text-sm font-semibold text-text">{STATUS_LABELS[status]}</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {list.map((fav) =>
                fav.work ? <WorkCover key={fav.id} work={fav.work} /> : null
              )}
            </div>
          </section>
        );
      })}

      {history.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Histórico recente</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {history.map((h) =>
              h.work ? (
                <li key={h.id}>
                  <Link
                    href={`/work/${h.work.slug}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-elevated"
                  >
                    <span className="line-clamp-1 text-sm text-text">{h.work.title}</span>
                    {h.chapterNumber > 0 ? (
                      <span className="shrink-0 text-xs text-muted">Cap. {h.chapterNumber}</span>
                    ) : null}
                  </Link>
                </li>
              ) : null
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
