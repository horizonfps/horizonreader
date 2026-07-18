"use client";

import { useEffect, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { Star } from "lucide-react";
import { coverProxy, workHref, type Card } from "@/lib/cards";
import PrefetchLink from "@/components/PrefetchLink";

type Page = { items: Card[]; nextCursor: number | null };

const fetcher = (url: string): Promise<Page> => fetch(url).then((r) => r.json());

function MangaCard({ item }: { item: Card }) {
  const src = coverProxy(item.coverUrl);
  return (
    <PrefetchLink href={workHref(item)} className="block">
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
        {item.rating != null ? (
          <span className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur">
            <Star className="h-3 w-3 fill-accent text-accent" />
            {item.rating.toFixed(1)}
          </span>
        ) : null}
        {item.type ? (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium capitalize backdrop-blur">
            {item.type}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-tight text-text">{item.title}</p>
    </PrefetchLink>
  );
}

export default function InfiniteGrid({
  endpoint,
  initialKeyReset,
}: {
  endpoint: string;
  initialKeyReset?: string;
}) {
  const getKey = (index: number, prev: Page | null): string | null => {
    if (index > 0 && (!prev || prev.nextCursor == null)) return null;
    if (index === 0) return endpoint;
    const sep = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${sep}cursor=${prev!.nextCursor}`;
  };

  const { data, size, setSize, isValidating } = useSWRInfinite<Page>(getKey, fetcher, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
  });

  // Reset pagination when the source endpoint changes.
  useEffect(() => {
    setSize(1);
  }, [endpoint, initialKeyReset, setSize]);

  const items = data ? data.flatMap((p) => p?.items ?? []) : [];
  const reachedEnd = data ? data[data.length - 1]?.nextCursor == null : false;
  const isEmpty = !isValidating && items.length === 0;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isValidating && !reachedEnd) {
          setSize((s) => s + 1);
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isValidating, reachedEnd, setSize, size]);

  const seen = new Set<string>();

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {items.map((item) => {
          const key = `${item.origin}:${item.externalId}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return <MangaCard key={key} item={item} />;
        })}
      </div>

      {isEmpty ? (
        <p className="py-12 text-center text-sm text-muted">Nada aqui.</p>
      ) : null}

      {!reachedEnd ? <div ref={sentinelRef} aria-hidden className="h-1 w-full" /> : null}

      {isValidating && !isEmpty ? (
        <div className="flex justify-center py-6">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
        </div>
      ) : null}
    </div>
  );
}
