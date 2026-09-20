import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLatestUpdates, LATEST_PAGE_MAX } from "@/lib/backbone/latest";
import LatestUpdates from "@/components/LatestUpdates";

export const dynamic = "force-dynamic";

export const metadata = { title: "Últimas atualizações" };

const PAGER =
  "flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:bg-elevated hover:text-text";

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const pageNum = Math.min(LATEST_PAGE_MAX, Math.max(1, Number(p) || 1));
  const updates = await getLatestUpdates(pageNum - 1).catch(() => []);
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Últimas atualizações</h1>
        <span className="text-xs text-muted">Página {pageNum}</span>
      </div>
      {updates.length ? (
        <LatestUpdates updates={updates} now={now} />
      ) : (
        <p className="py-10 text-sm text-muted">Nada por aqui agora.</p>
      )}
      <nav className="flex items-center justify-between pt-2">
        {pageNum > 1 ? (
          <Link href={`/updates?p=${pageNum - 1}`} className={PAGER}>
            <ChevronLeft className="h-4 w-4" /> Mais recentes
          </Link>
        ) : (
          <span />
        )}
        {pageNum < LATEST_PAGE_MAX && updates.length ? (
          <Link href={`/updates?p=${pageNum + 1}`} className={PAGER}>
            Mais antigas <ChevronRight className="h-4 w-4" />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
