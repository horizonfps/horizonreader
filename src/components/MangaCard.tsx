import type { Card } from "@/lib/cards";
import { coverProxy, workHref } from "@/lib/cards";
import { typeLabel } from "@/lib/labels";
import PrefetchLink from "@/components/PrefetchLink";
import RatingBadge from "@/components/RatingBadge";

export default function MangaCard({
  item,
  showTitle = true,
  caption,
  priority,
  href,
  badge,
}: {
  item: Card;
  showTitle?: boolean;
  caption?: string | null;
  priority?: boolean;
  href?: string;
  badge?: string | null;
}) {
  const src = coverProxy(item.coverUrl);
  return (
    <PrefetchLink href={href ?? workHref(item)} className="group block">
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
        <RatingBadge rating={item.rating} />
        {badge ? (
          <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent">
            {badge}
          </span>
        ) : null}
        {item.type ? (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-text backdrop-blur">
            {typeLabel(item.type)}
          </span>
        ) : null}
      </div>
      {showTitle ? (
        <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight text-text group-hover:text-accent">
          {item.title}
        </p>
      ) : null}
      {caption ? <p className="mt-0.5 truncate text-[11px] text-muted">{caption}</p> : null}
    </PrefetchLink>
  );
}
