"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import type { EmblaCarouselType } from "embla-carousel";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { coverProxy } from "@/lib/cards";

type FavItem = {
  slug: string;
  title: string;
  coverUrl?: string | null;
  rating?: number | null;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export default function FavoritesCarousel({ items }: { items: FavItem[] }) {
  const loop = items.length > 2;
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop, align: "center" });

  const tweenNodes = useRef<HTMLElement[]>([]);
  const tweenFactor = useRef(0);

  const setTweenNodes = useCallback((api: EmblaCarouselType) => {
    tweenNodes.current = api
      .slideNodes()
      .map((node) => node.querySelector(".fav-tween") as HTMLElement);
  }, []);

  const setTweenFactor = useCallback((api: EmblaCarouselType) => {
    tweenFactor.current = 0.72 * api.scrollSnapList().length;
  }, []);

  // Scale + dim each slide by its distance from the centered snap; loop points
  // are corrected so the wrap boundary does not jump.
  const tween = useCallback((api: EmblaCarouselType, eventName?: string) => {
    const engine = api.internalEngine();
    const scrollProgress = api.scrollProgress();
    const slidesInView = api.slidesInView();
    const isScroll = eventName === "scroll";

    api.scrollSnapList().forEach((scrollSnap, snapIndex) => {
      let diffToTarget = scrollSnap - scrollProgress;
      const slidesInSnap = engine.slideRegistry[snapIndex];

      slidesInSnap.forEach((slideIndex) => {
        if (isScroll && !slidesInView.includes(slideIndex)) return;

        if (engine.options.loop) {
          engine.slideLooper.loopPoints.forEach((loopItem) => {
            const target = loopItem.target();
            if (slideIndex === loopItem.index && target !== 0) {
              const sign = Math.sign(target);
              if (sign === -1) diffToTarget = scrollSnap - (1 + scrollProgress);
              if (sign === 1) diffToTarget = scrollSnap + (1 - scrollProgress);
            }
          });
        }

        const t = clamp(1 - Math.abs(diffToTarget * tweenFactor.current), 0, 1);
        const node = tweenNodes.current[slideIndex];
        if (!node) return;
        node.style.transform = `scale(${(0.78 + 0.22 * t).toFixed(4)})`;
        node.style.opacity = (0.38 + 0.62 * t).toFixed(4);
        node.style.zIndex = t > 0.9 ? "10" : "0";
      });
    });
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    setTweenNodes(emblaApi);
    setTweenFactor(emblaApi);
    tween(emblaApi);
    emblaApi
      .on("reInit", setTweenNodes)
      .on("reInit", setTweenFactor)
      .on("reInit", tween)
      .on("scroll", tween)
      .on("slideFocus", tween);
  }, [emblaApi, tween, setTweenNodes, setTweenFactor]);

  if (!items.length) return null;

  return (
    <div className="relative">
      <div className="overflow-hidden py-3" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {items.map((item) => {
            const src = coverProxy(item.coverUrl);
            return (
              <div key={item.slug} className="min-w-0 flex-[0_0_66%] px-2 sm:flex-[0_0_46%]">
                <div className="fav-tween origin-center will-change-transform">
                  <Link
                    href={`/work/${item.slug}`}
                    className="block overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/50"
                  >
                    <div className="relative aspect-[2/3] w-full">
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
                        <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-text backdrop-blur">
                          <Star className="h-3 w-3 fill-accent text-accent" />
                          {item.rating.toFixed(1)}
                        </span>
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent p-3 pt-10">
                        <p className="line-clamp-2 text-sm font-semibold leading-tight text-text">
                          {item.title}
                        </p>
                        <div className="mt-2 h-px w-full bg-white/25" />
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {loop ? (
        <>
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => emblaApi?.scrollPrev()}
            className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-text backdrop-blur transition-colors hover:bg-black/70"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Próximo"
            onClick={() => emblaApi?.scrollNext()}
            className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-text backdrop-blur transition-colors hover:bg-black/70"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}
    </div>
  );
}
