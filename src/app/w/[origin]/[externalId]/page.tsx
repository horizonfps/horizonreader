import { redirect } from "next/navigation";
import { resolveWorkFromRef } from "@/lib/backbone/resolve";

export const dynamic = "force-dynamic";

// Bridge from a home/browse/search item ref to the canonical Work page.
export default async function RefResolverPage({
  params,
  searchParams,
}: {
  params: Promise<{ origin: string; externalId: string }>;
  searchParams: Promise<{ t?: string; c?: string }>;
}) {
  const { origin, externalId } = await params;
  const { t, c } = await searchParams;

  const resolved = await resolveWorkFromRef({
    origin: origin as "mangadex" | "comick",
    externalId: decodeURIComponent(externalId),
    title: t,
    coverUrl: c,
  });

  // redirect throws internally; never wrap it in try/catch.
  if (resolved?.slug) redirect("/work/" + resolved.slug);
  redirect("/?error=notfound");
}
