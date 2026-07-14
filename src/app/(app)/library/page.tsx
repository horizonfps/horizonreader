import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { coverProxy, STATUS_ORDER, STATUS_LABELS, type FavStatus } from "@/lib/cards";
import RatingBadge from "@/components/RatingBadge";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { status } = await searchParams;
  const active = STATUS_ORDER.includes(status as FavStatus) ? (status as FavStatus) : null;

  const favorites = await prisma.favorite
    .findMany({
      where: { userId: session.uid },
      include: { work: true },
      orderBy: { updatedAt: "desc" },
    })
    .catch(() => []);

  const shown = active ? favorites.filter((f) => f.status === active) : favorites;

  const chipClass = (isActive: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
      isActive
        ? "border-accent bg-accent text-on-accent"
        : "border-border bg-surface text-muted hover:bg-elevated"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold">Biblioteca</h1>
        <span className="text-xs text-muted">{shown.length} título(s)</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link href="/library" className={chipClass(active === null)}>
          Todos
        </Link>
        {STATUS_ORDER.map((key) => (
          <Link key={key} href={`/library?status=${key}`} className={chipClass(active === key)}>
            {STATUS_LABELS[key]}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-sm text-muted">Nada aqui ainda.</p>
          <Link
            href="/browse"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Explorar
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {shown.map((fav) => {
            const work = fav.work;
            if (!work) return null;
            const src = coverProxy(work.coverUrl);
            return (
              <Link key={fav.id} href={`/work/${work.slug}`} className="block">
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : null}
                  <RatingBadge rating={work.rating} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-tight text-text">{work.title}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
