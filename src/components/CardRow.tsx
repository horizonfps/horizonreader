import { coverProxy } from "@/lib/cards";
import PrefetchLink from "@/components/PrefetchLink";
import RatingBadge from "@/components/RatingBadge";

export type RowItem = {
  href: string;
  title: string;
  coverUrl?: string | null;
  rating?: number | null;
  type?: string | null;
};

// Horizontal, swipeable strip of covers (home Populares / Best New / Continuar).
export default function CardRow({
  items,
  showTitle = true,
}: {
  items: RowItem[];
  showTitle?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
      {items.map((it, i) => {
        const src = coverProxy(it.coverUrl);
        return (
          <PrefetchLink
            key={`${it.href}:${i}`}
            href={it.href}
            className="flex-[0_0_31%] shrink-0 sm:flex-[0_0_23%] md:flex-[0_0_18%] lg:flex-[0_0_14%] xl:flex-[0_0_12%]"
          >
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
              <RatingBadge rating={it.rating} />
              {it.type ? (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium capitalize text-text backdrop-blur">
                  {it.type}
                </span>
              ) : null}
            </div>
            {showTitle ? (
              <p className="mt-1 line-clamp-2 text-xs leading-tight text-text">{it.title}</p>
            ) : null}
          </PrefetchLink>
        );
      })}
    </div>
  );
}
