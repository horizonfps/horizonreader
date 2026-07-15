"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

// Warms the expensive source-resolution path on hover/touch intent: fetching
// /w/... follows the redirect into /work/[slug], populating SourceLink rows and
// Suwayomi caches so the real click hits the fast cached path.
const warmed = new Set<string>();
let inFlight = 0;
const MAX_INFLIGHT = 3;

function warm(href: string) {
  if (!href.startsWith("/w/") || warmed.has(href)) return;
  if (inFlight >= MAX_INFLIGHT) return;
  warmed.add(href);
  inFlight += 1;
  fetch(href, { redirect: "follow" })
    .then((r) => r.text())
    .catch(() => {})
    .finally(() => {
      inFlight -= 1;
    });
}

export default function PrefetchLink({
  href,
  ...rest
}: ComponentProps<typeof Link>) {
  const url = typeof href === "string" ? href : "";
  return (
    <Link
      href={href}
      onPointerEnter={() => warm(url)}
      onTouchStart={() => warm(url)}
      {...rest}
    />
  );
}
