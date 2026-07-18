"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { ComponentProps } from "react";

// Warms the expensive source-resolution path before the click via /api/warm,
// which canonicalizes the work and queues source resolution server-side in a
// throttled background lane. Cards warm as they scroll into view; hover/touch
// intent jumps the queue.
const warmed = new Set<string>();
const queue: string[] = [];
let inFlight = 0;
const MAX_INFLIGHT = 3;

function isWarmable(href: string): boolean {
  return href.startsWith("/w/") || href.startsWith("/work/");
}

function pump() {
  while (inFlight < MAX_INFLIGHT && queue.length) {
    const href = queue.shift()!;
    inFlight += 1;
    fetch("/api/warm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ href }),
    })
      .catch(() => {})
      .finally(() => {
        inFlight -= 1;
        pump();
      });
  }
}

function warm(href: string, urgent = false) {
  if (!isWarmable(href) || warmed.has(href)) return;
  warmed.add(href);
  if (urgent) queue.unshift(href);
  else queue.push(href);
  pump();
}

const hrefByEl = new WeakMap<Element, string>();
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          observer!.unobserve(e.target);
          const href = hrefByEl.get(e.target);
          if (href) warm(href);
        }
      },
      { rootMargin: "150px" },
    );
  }
  return observer;
}

export default function PrefetchLink({
  href,
  ...rest
}: ComponentProps<typeof Link>) {
  const url = typeof href === "string" ? href : "";
  const observe = useCallback(
    (el: HTMLAnchorElement | null) => {
      if (!el || !isWarmable(url) || warmed.has(url)) return;
      const io = getObserver();
      if (!io) return;
      hrefByEl.set(el, url);
      io.observe(el);
      return () => io.unobserve(el);
    },
    [url],
  );
  return (
    <Link
      ref={observe}
      href={href}
      onPointerEnter={() => warm(url, true)}
      onTouchStart={() => warm(url, true)}
      {...rest}
    />
  );
}
