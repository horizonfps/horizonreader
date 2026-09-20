import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLatestUpdates, LATEST_PAGE_MAX, type LatestLang } from "@/lib/backbone/latest";
import LatestUpdates from "@/components/LatestUpdates";

export const dynamic = "force-dynamic";

export const metadata = { title: "Últimas atualizações" };

const PAGER =
  "flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:bg-elevated hover:text-text";

const LANGS: { value: LatestLang; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pt-br", label: "Português" },
  { value: "en", label: "Inglês" },
];

function parseLang(v?: string): LatestLang {
  return v === "pt-br" || v === "en" ? v : "all";
}

function href(page: number, lang: LatestLang): string {
  const qs = new URLSearchParams();
  if (page > 1) qs.set("p", String(page));
  if (lang !== "all") qs.set("lang", lang);
  const s = qs.toString();
  return s ? `/updates?${s}` : "/updates";
}

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; lang?: string }>;
}) {
  const { p, lang: rawLang } = await searchParams;
  const lang = parseLang(rawLang);
  const pageNum = Math.min(LATEST_PAGE_MAX, Math.max(1, Number(p) || 1));
  const updates = await getLatestUpdates(pageNum - 1, lang).catch(() => []);
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Últimas atualizações</h1>
        <span className="text-xs text-muted">Página {pageNum}</span>
        <div className="ml-auto flex gap-1">
          {LANGS.map((l) => (
            <Link
              key={l.value}
              href={href(1, l.value)}
              className={`rounded-full px-3 py-1 text-xs ${
                l.value === lang ? "bg-accent font-medium text-on-accent" : "bg-elevated text-muted hover:text-text"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      {updates.length ? (
        <LatestUpdates updates={updates} now={now} />
      ) : (
        <p className="py-10 text-sm text-muted">Nada por aqui agora.</p>
      )}
      <nav className="flex items-center justify-between pt-2">
        {pageNum > 1 ? (
          <Link href={href(pageNum - 1, lang)} className={PAGER}>
            <ChevronLeft className="h-4 w-4" /> Mais recentes
          </Link>
        ) : (
          <span />
        )}
        {pageNum < LATEST_PAGE_MAX && updates.length ? (
          <Link href={href(pageNum + 1, lang)} className={PAGER}>
            Mais antigas <ChevronRight className="h-4 w-4" />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
