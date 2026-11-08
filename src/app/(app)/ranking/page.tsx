import Link from "next/link";
import { Flame, User as UserIcon } from "lucide-react";
import { getSession } from "@/lib/session";
import { coverProxy } from "@/lib/cards";
import {
  computeReaderStats,
  PERIODS,
  rankReaders,
  SORTS,
  sortValue,
  type Period,
  type ReaderStats,
  type SortKey,
} from "@/lib/readerStats";
import Username from "@/components/Username";
import AdminBadge from "@/components/AdminBadge";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ranking" };

const fmt = (n: number) => n.toLocaleString("pt-BR");

function Avatar({ url, className }: { url: string | null; className: string }) {
  const src = coverProxy(url);
  return (
    <div className={`shrink-0 overflow-hidden rounded-full border border-border bg-surface ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <UserIcon className="h-1/2 w-1/2" />
        </div>
      )}
    </div>
  );
}

function metricCell(s: ReaderStats, key: SortKey): string {
  if (key === "level") return `Nv ${s.level}`;
  return fmt(sortValue(s, key));
}

const PODIUM_STYLE = [
  "order-2 border-amber-400/60 bg-amber-400/10 sm:-mt-4",
  "order-1 border-slate-300/50 bg-slate-300/5",
  "order-3 border-orange-500/50 bg-orange-500/5",
];

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; por?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const period: Period = PERIODS.some((p) => p.id === sp.periodo) ? (sp.periodo as Period) : "7d";
  const sort: SortKey = SORTS.some((s) => s.id === sp.por) ? (sp.por as SortKey) : "chapters";

  const ranked = rankReaders(await computeReaderStats(period).catch(() => []), sort);
  const podium = ranked.slice(0, 3).filter((s) => sortValue(s, sort) > 0);
  const sortLabel = SORTS.find((s) => s.id === sort)!.label;
  const href = (p: Period, s: SortKey) => `/ranking?periodo=${p}&por=${s}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Ranking</h1>
        <div className="ml-auto flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.id}
              href={href(p.id, sort)}
              scroll={false}
              className={`rounded-md px-3 py-1 ${
                p.id === period ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-text"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:hidden">
        {SORTS.map((s) => (
          <Link
            key={s.id}
            href={href(period, s.id)}
            scroll={false}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${
              s.id === sort ? "bg-accent text-on-accent" : "bg-surface text-muted hover:bg-elevated hover:text-text"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>
      {sort === "streak" || sort === "level" ? (
        <p className="-mt-3 text-xs text-muted">
          {sort === "streak"
            ? "Dias seguidos com leitura até hoje, independente do período."
            : "XP total: 10 por capítulo, 25 por dia ativo, 100 por obra concluída."}
        </p>
      ) : null}

      {podium.length > 0 ? (
        <section
          className="mx-auto grid items-end gap-2 sm:gap-4"
          style={{
            gridTemplateColumns: `repeat(${podium.length}, minmax(0, 1fr))`,
            maxWidth: `${podium.length * 33.4}%`,
          }}
        >
          {podium.map((s, i) => (
            <Link
              key={s.user.id}
              href={`/u/${encodeURIComponent(s.user.username)}`}
              className={`flex min-w-0 flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center transition-transform hover:-translate-y-0.5 ${PODIUM_STYLE[i]}`}
            >
              <span className="text-lg font-bold tabular-nums text-text">{i + 1}º</span>
              <Avatar
                url={s.user.avatarUrl}
                className={i === 0 ? "h-16 w-16 sm:h-20 sm:w-20" : "h-12 w-12 sm:h-16 sm:w-16"}
              />
              <Username
                name={s.user.displayName || s.user.username}
                isAdmin={s.user.isAdmin}
                className="max-w-full truncate text-sm text-text"
              />
              <span className="text-xl font-semibold tabular-nums text-text sm:text-2xl">{metricCell(s, sort)}</span>
              {sort !== "level" ? <span className="text-[11px] text-muted">{sortLabel.toLowerCase()}</span> : null}
            </Link>
          ))}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[2.5rem_minmax(0,1fr)_repeat(6,5.25rem)] gap-2 border-b border-border bg-surface px-3 py-2 text-[11px] uppercase tracking-wide text-muted sm:grid">
          <span>#</span>
          <span>Leitor</span>
          {SORTS.map((s) => (
            <Link
              key={s.id}
              href={href(period, s.id)}
              scroll={false}
              className={`text-right hover:text-text ${s.id === sort ? "font-semibold text-accent" : ""}`}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <ol className="divide-y divide-border">
          {ranked.map((s, i) => {
            const me = s.user.id === session.uid;
            const idle = sortValue(s, sort) === 0;
            return (
              <li key={s.user.id} className={me ? "bg-accent/10" : idle ? "opacity-60" : ""}>
                <Link
                  href={`/u/${encodeURIComponent(s.user.username)}`}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 hover:bg-elevated sm:grid-cols-[2.5rem_minmax(0,1fr)_repeat(6,5.25rem)]"
                >
                  <span className="text-sm font-semibold tabular-nums text-muted">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar url={s.user.avatarUrl} className="h-9 w-9" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1">
                        <Username
                          name={s.user.displayName || s.user.username}
                          isAdmin={s.user.isAdmin}
                          className="truncate text-sm text-text"
                        />
                        {s.user.isAdmin ? <AdminBadge className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span className="rounded bg-elevated px-1 text-[10px] font-semibold text-text">
                          Nv {s.level}
                        </span>
                        {s.streak > 1 ? (
                          <span className="flex items-center gap-0.5 text-orange-400">
                            <Flame className="h-3 w-3" />
                            {s.streak}
                          </span>
                        ) : null}
                        <span className="truncate">@{s.user.username}</span>
                      </span>
                    </span>
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-text sm:hidden">
                    {metricCell(s, sort)}
                  </span>
                  {SORTS.map((col) => (
                    <span
                      key={col.id}
                      className={`hidden text-right text-sm tabular-nums sm:block ${
                        col.id === sort ? "font-semibold text-text" : "text-muted"
                      }`}
                    >
                      {metricCell(s, col.id)}
                    </span>
                  ))}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
