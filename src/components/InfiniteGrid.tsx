"use client";

import { useEffect, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import type { Card } from "@/lib/cards";
import MangaCard from "@/components/MangaCard";

type Page = { items: Card[]; nextCursor: number | null };

const fetcher = (url: string): Promise<Page> => fetch(url).then((r) => r.json());

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
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
        {items.map((item, i) => {
          const key = `${item.origin}:${item.externalId}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return <MangaCard key={key} item={item} priority={i < 6} />;
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
