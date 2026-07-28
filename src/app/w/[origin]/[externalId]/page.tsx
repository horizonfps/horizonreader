import { redirect } from "next/navigation";
import { lookupRefSlug, resolveWorkFromRef, queueSourceResolve } from "@/lib/backbone/resolve";
import NotFoundView from "@/components/NotFoundView";

export const dynamic = "force-dynamic";

// Bridge from a home/browse/search item ref to the canonical Work page.
export default async function RefResolverPage({
  params,
  searchParams,
}: {
  params: Promise<{ origin: string; externalId: string }>;
  searchParams: Promise<{ t?: string; c?: string }>;
}) {
  const { origin: rawOrigin, externalId: rawId } = await params;
  const { t, c } = await searchParams;
  const origin = rawOrigin as "mangadex" | "comick";
  const externalId = decodeURIComponent(rawId);

  // A Work already in the DB redirects on a single indexed query. Refreshing
  // stale metadata is worth nothing to the reader waiting on the redirect, so
  // it runs detached.
  const known = await lookupRefSlug({ origin, externalId });
  if (known) {
    queueSourceResolve(known.workId);
    if (known.stale) {
      void resolveWorkFromRef({ origin, externalId, title: t, coverUrl: c }).catch(() => {});
    }
    redirect("/work/" + known.slug);
  }

  const resolved = await resolveWorkFromRef({ origin, externalId, title: t, coverUrl: c });

  // redirect throws internally; never wrap it in try/catch.
  if (resolved?.slug) {
    queueSourceResolve(resolved.workId);
    redirect("/work/" + resolved.slug);
  }
  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto max-w-app px-4 pb-24 pt-3">
        <NotFoundView
          title="Obra indisponível"
          message="Não conseguimos carregar esta obra agora. Ela pode ter sido removida da fonte."
        />
      </main>
    </div>
  );
}
