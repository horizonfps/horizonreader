import { coverProxy } from "@/lib/cards";
import { typeLabel } from "@/lib/labels";
import PrefetchLink from "@/components/PrefetchLink";
import RatingBadge from "@/components/RatingBadge";

export type RowItem = {
  href: string;
  title: string;
  coverUrl?: string | null;
  rating?: number | null;
  type?: string | null;
  caption?: string | null;
};

// Horizontal, swipeable strip of covers.
export default function CardRow({
  items,
  showTitle = true,
  prefetch,
}: {
  items: RowItem[];
  showTitle?: boolean;
  prefetch?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
      {items.map((it, i) => {
        const src = coverProxy(it.coverUrl);
        const priority = i < 2;
        return (
          <PrefetchLink
            key={`${it.href}:${i}`}
            href={it.href}
            prefetch={prefetch}
            className="group flex-[0_0_31%] shrink-0 snap-start sm:flex-[0_0_23%] md:flex-[0_0_18%] lg:flex-[0_0_15%] xl:flex-[0_0_12%] 2xl:flex-[0_0_10%]"
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface ring-1 ring-white/5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:ring-accent/60">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  loading={priority ? "eager" : "lazy"}
                  fetchPriority={priority ? "high" : undefined}
                  draggable={false}
                  className="cover-img h-full w-full object-cover"
                />
              ) : null}
              <RatingBadge rating={it.rating} />
              {it.type ? (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-text backdrop-blur">
                  {typeLabel(it.type)}
                </span>
              ) : null}
            </div>
            {showTitle ? (
              <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight text-text group-hover:text-accent">
                {it.title}
              </p>
            ) : null}
            {it.caption ? <p className="mt-0.5 truncate text-[11px] text-muted">{it.caption}</p> : null}
          </PrefetchLink>
        );
      })}
    </div>
  );
}
