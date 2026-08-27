"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Card, bytes, count } from "./ui";

type Item = {
  chapterId: number;
  workId: number | null;
  workTitle: string | null;
  chapterName: string;
  chapterNumber: number;
  status: string;
  bytes: number;
  error: string | null;
};

type Snapshot = { items: Item[] };

type Scope = "error" | "done" | "all";

type Group = {
  key: string;
  workId: number | null;
  title: string;
  items: Item[];
  bytes: number;
};

const SCOPES: Scope[] = ["error", "done", "all"];

const SCOPE_LABELS: Record<Scope, string> = {
  error: "Apagar com erro",
  done: "Apagar concluídos",
  all: "Apagar tudo",
};

const MAX_GROUPS = 10;
const MAX_ERRORS = 20;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const BUTTON =
  "rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[11px] text-text transition-colors hover:border-red-400/40 hover:text-red-300 disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text";

function chapterLabel(item: Item): string {
  return item.chapterName?.trim() || `Cap. ${item.chapterNumber}`;
}

function groupByWork(items: Item[]): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    const key = item.workId == null ? "none" : String(item.workId);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        workId: item.workId,
        title: item.workId == null ? "Sem obra" : item.workTitle || `Obra ${item.workId}`,
        items: [],
        bytes: 0,
      };
      map.set(key, group);
    }
    group.items.push(item);
    group.bytes += item.bytes;
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

export default function AppDownloadsPanel() {
  const [pending, setPending] = useState<Scope | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const scopeRow = useRef<HTMLDivElement | null>(null);

  const { data, mutate } = useSWR<Snapshot>("/api/download", fetcher, {
    refreshInterval: 15_000,
    keepPreviousData: true,
  });

  // A click anywhere outside the three bulk buttons drops the pending confirm.
  useEffect(() => {
    if (!pending) return;
    const onClick = (e: MouseEvent) => {
      if (!scopeRow.current?.contains(e.target as Node)) setPending(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [pending]);

  const items = data?.items ?? [];
  const errors = items.filter((i) => i.status === "ERROR");
  const counts: Record<Scope, number> = {
    error: errors.length,
    done: items.filter((i) => i.status === "DONE").length,
    all: items.length,
  };
  const groups = groupByWork(items);
  const shown = groups.slice(0, MAX_GROUPS);
  const hidden = groups.length - shown.length;

  function report(removed: number, freed: number) {
    setResult(
      removed > 0
        ? `Apagados ${count(removed)} capítulo(s) · ${bytes(freed)} liberados`
        : "Nada para apagar",
    );
  }

  async function act(key: string, run: () => Promise<void>) {
    if (busy) return;
    setPending(null);
    setBusy(key);
    try {
      await run();
    } catch {
      setResult("Não deu para apagar");
    } finally {
      setBusy(null);
      await mutate();
    }
  }

  const runBulk = (scope: Scope) =>
    act(scope, async () => {
      const res = await fetch("/api/download/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const json = (await res.json().catch(() => null)) as
        | { removed?: number; bytesFreed?: number }
        | null;
      if (!res.ok || !json) throw new Error("bulk failed");
      report(Number(json.removed) || 0, Number(json.bytesFreed) || 0);
    });

  const removeGroup = (group: Group) =>
    act(`w${group.key}`, async () => {
      if (group.workId == null) {
        for (const item of group.items) {
          const res = await fetch(`/api/download?chapterId=${item.chapterId}`, { method: "DELETE" });
          if (!res.ok) throw new Error("delete failed");
        }
        report(group.items.length, group.bytes);
        return;
      }
      const res = await fetch(`/api/download?workId=${group.workId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { removed?: number } | null;
      if (!res.ok || !json) throw new Error("delete failed");
      const removed = Number(json.removed) || 0;
      report(removed, removed ? group.bytes : 0);
    });

  const removeChapter = (item: Item) =>
    act(`c${item.chapterId}`, async () => {
      const res = await fetch(`/api/download?chapterId=${item.chapterId}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { removed?: number } | null;
      if (!res.ok || !json) throw new Error("delete failed");
      const removed = Number(json.removed) || 0;
      report(removed, removed ? item.bytes : 0);
    });

  return (
    <Card title="Limpeza de downloads">
      <div ref={scopeRow} className="flex flex-wrap gap-2">
        {SCOPES.map((scope) => (
          <button
            key={scope}
            onClick={() => (pending === scope ? void runBulk(scope) : setPending(scope))}
            disabled={counts[scope] === 0 || busy === scope}
            className={`${BUTTON} ${pending === scope ? "border-red-400/50 text-red-300" : ""}`}
          >
            {busy === scope
              ? "Apagando…"
              : pending === scope
                ? "Confirmar?"
                : `${SCOPE_LABELS[scope]} (${count(counts[scope])})`}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {shown.length ? (
          <div className="divide-y divide-border/60">
            {shown.map((group) => (
              <div key={group.key} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{group.title}</p>
                  <p className="text-[11px] tabular-nums text-muted">
                    {count(group.items.length)} capítulo(s) · {bytes(group.bytes)}
                  </p>
                </div>
                <button
                  onClick={() => void removeGroup(group)}
                  disabled={busy === `w${group.key}`}
                  className={`${BUTTON} shrink-0`}
                >
                  {busy === `w${group.key}` ? "Apagando…" : "Apagar todos"}
                </button>
              </div>
            ))}
            {hidden > 0 ? (
              <p className="pt-2 text-[11px] text-muted">+{count(hidden)} obras</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">Nenhum capítulo baixado.</p>
        )}
      </div>

      {errors.length ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">
            Capítulos com erro
          </p>
          <div className="divide-y divide-border/60">
            {errors.slice(0, MAX_ERRORS).map((item) => (
              <div key={item.chapterId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{chapterLabel(item)}</p>
                  <p className="truncate text-[11px] text-red-300">{item.error || "erro"}</p>
                </div>
                <button
                  onClick={() => void removeChapter(item)}
                  disabled={busy === `c${item.chapterId}`}
                  className={`${BUTTON} shrink-0`}
                >
                  {busy === `c${item.chapterId}` ? "Apagando…" : "Apagar"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result ? <p className="mt-3 text-[11px] text-muted">{result}</p> : null}
    </Card>
  );
}
