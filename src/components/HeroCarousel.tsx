"use client";

import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import PrefetchLink from "@/components/PrefetchLink";
import { coverProxy } from "@/lib/cards";
import { typeLabel, statusLabel } from "@/lib/labels";

export type HeroItem = {
  href: string;
  title: string;
  coverUrl: string | null;
  description: string | null;
  genres: string[];
  rating: number | null;
  type: string | null;
  status: string | null;
  year: number | null;
};

const AUTOPLAY_MS = 7_000;

export default function HeroCarousel({ items }: { items: HeroItem[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: items.length > 1, duration: 28 });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const onSelect = useCallback(() => {
    if (emblaApi) setIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect).on("reInit", onSelect);
  }, [emblaApi, onSelect]);

  useEffect(() => {
    if (!emblaApi || paused || items.length < 2) return;
    const t = setInterval(() => emblaApi.scrollNext(), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [emblaApi, paused, items.length]);

  if (!items.length) return null;

  return (
    <section
      className="relative -mx-4 overflow-hidden sm:mx-0 sm:rounded-2xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex touch-pan-y">
          {items.map((item, i) => {
            const src = coverProxy(item.coverUrl, "large");
            const meta = [typeLabel(item.type), statusLabel(item.status), item.year]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={item.href} className="relative min-w-0 flex-[0_0_100%]">
                {src ? (
                  <div
                    aria-hidden
                    className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                    style={{ backgroundImage: `url("${src}")`, opacity: 0.55 }}
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20 sm:bg-gradient-to-r sm:from-bg sm:via-bg/80 sm:to-bg/30" />
                <div className="relative flex gap-4 px-4 pb-6 pt-6 sm:gap-6 sm:px-8 sm:py-8 lg:gap-8 lg:px-10 lg:py-10">
                  <PrefetchLink
                    href={item.href}
                    className="block w-28 shrink-0 overflow-hidden rounded-lg shadow-2xl shadow-black/60 sm:w-40 lg:w-48"
                  >
                    <div className="aspect-[2/3] w-full bg-surface">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={src}
                          alt=""
                          loading={i === 0 ? "eager" : "lazy"}
                          fetchPriority={i === 0 ? "high" : undefined}
                          draggable={false}
                          className="cover-img h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                  </PrefetchLink>
                  <div className="flex min-w-0 flex-1 flex-col justify-end sm:justify-center">
                    <PrefetchLink href={item.href} className="block">
                      <h2 className="line-clamp-2 text-xl font-bold leading-tight tracking-tight text-text sm:text-3xl lg:text-4xl">
                        {item.title}
                      </h2>
                    </PrefetchLink>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:text-sm">
                      {item.rating != null ? (
                        <span className="flex items-center gap-1 text-text">
                          <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                          {item.rating.toFixed(1)}
                        </span>
                      ) : null}
                      {meta ? <span>{meta}</span> : null}
                    </div>
                    {item.genres.length ? (
                      <div className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
                        {item.genres.slice(0, 6).map((g) => (
                          <span
                            key={g}
                            className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text/90"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.description ? (
                      <p className="mt-3 hidden max-w-3xl text-sm leading-relaxed text-text/80 sm:line-clamp-3 lg:line-clamp-4">
                        {item.description}
                      </p>
                    ) : null}
                    <div className="mt-4 hidden sm:block">
                      <PrefetchLink
                        href={item.href}
                        className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
                      >
                        Ver obra
                      </PrefetchLink>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {items.length > 1 ? (
        <>
          <div className="absolute right-4 top-3 z-10 flex items-center gap-2 sm:bottom-4 sm:right-6 sm:top-auto">
            <span className="text-xs tabular-nums text-muted">
              {index + 1}/{items.length}
            </span>
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => emblaApi?.scrollPrev()}
              className="hidden h-8 w-8 items-center justify-center rounded-full bg-black/50 text-text backdrop-blur transition-colors hover:bg-black/70 sm:flex"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Próximo"
              onClick={() => emblaApi?.scrollNext()}
              className="hidden h-8 w-8 items-center justify-center rounded-full bg-black/50 text-text backdrop-blur transition-colors hover:bg-black/70 sm:flex"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-10 flex h-0.5">
            {items.map((it, i) => (
              <span
                key={it.href}
                className={`flex-1 transition-colors ${i === index ? "bg-accent" : "bg-white/10"}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
