import Link from "next/link";
import type { Card } from "@/lib/cards";
import { coverProxy, workHref } from "@/lib/cards";
import RatingBadge from "@/components/RatingBadge";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function MangaCard({
  item,
  showTitle = true,
}: {
  item: Card;
  showTitle?: boolean;
}) {
  const src = coverProxy(item.coverUrl);
  return (
    <Link href={workHref(item)} className="block">
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null}
        <RatingBadge rating={item.rating} />
        {item.type ? (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-text backdrop-blur">
            {capitalize(item.type)}
          </span>
        ) : null}
      </div>
      {showTitle ? (
        <p className="mt-1 line-clamp-2 text-xs leading-tight text-text">{item.title}</p>
      ) : null}
    </Link>
  );
}
