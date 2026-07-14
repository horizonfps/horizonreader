"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Links back to the same page with ?refresh=1; the server re-resolves sources.
export default function RefreshSourcesButton({ workId }: { workId: number }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function refresh() {
    const next = new URLSearchParams(params.toString());
    next.set("refresh", "1");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      data-work-id={workId}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:bg-elevated disabled:opacity-50"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Atualizando fontes…" : "Atualizar fontes"}
    </button>
  );
}
