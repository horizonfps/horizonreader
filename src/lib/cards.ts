// Pure, isomorphic helpers shared by API routes, server components, and client
// components. No server-only imports here so client bundles can use it too.

import type { BackboneWork, SectionItem } from "@/lib/backbone/types";

export type Card = SectionItem;

export function backboneToCard(bw: BackboneWork): Card {
  return {
    origin: bw.origin === "comick" ? "comick" : "mangadex",
    externalId: bw.externalId,
    slug: null,
    title: bw.title,
    coverUrl: bw.coverUrl ?? null,
    type: bw.type ?? null,
    status: bw.status ?? null,
    rating: bw.rating ?? null,
    chapterCount: null,
    genres: bw.genres ?? [],
    contentRating: bw.contentRating ?? null,
  };
}

// Proxy backbone cover URLs through the app: the browser never talks to
// MangaDex/Comick directly (privacy) and hotlink/referer checks are avoided.
export function coverProxy(url?: string | null): string {
  if (!url) return "";
  // App-relative paths pass through; protocol-relative ("//host") must not.
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return `/api/cover?u=${encodeURIComponent(url)}`;
}

// A card links to the ref resolver, which canonicalizes to a local Work then
// redirects to /work/[slug]. Title + cover ride along for Comick canonicalization.
export function workHref(item: {
  origin: string;
  externalId: string;
  title?: string | null;
  coverUrl?: string | null;
}): string {
  const p = new URLSearchParams();
  if (item.title) p.set("t", item.title);
  if (item.coverUrl) p.set("c", item.coverUrl);
  const q = p.toString();
  return `/w/${item.origin}/${encodeURIComponent(item.externalId)}${q ? `?${q}` : ""}`;
}

export const STATUS_LABELS: Record<string, string> = {
  READING: "Reading",
  ON_HOLD: "On-hold",
  DROPPED: "Dropped",
  COMPLETED: "Completed",
  PLAN_TO_READ: "Plan to read",
};

export const STATUS_ORDER = ["READING", "ON_HOLD", "PLAN_TO_READ", "COMPLETED", "DROPPED"] as const;
export type FavStatus = (typeof STATUS_ORDER)[number];
