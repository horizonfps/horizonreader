"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { bytes, pct } from "@/components/info/ui";

type DownloadItem = {
  chapterId: number;
  workId: number | null;
  workTitle: string | null;
  workSlug: string | null;
  chapterName: string;
  chapterNumber: number;
  status: string;
  pageCount: number;
  pagesDone: number;
  bytes: number;
  error: string | null;
  updatedAt: string;
};

type DownloadStorage = {
  path: string;
  downloadsBytes: number;
  chapters: number;
  diskTotal: number;
  diskFree: number;
  diskUsed: number;
};

type Snapshot = { items: DownloadItem[]; storage: DownloadStorage };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Na fila",
  RUNNING: "Baixando",
  DONE: "Concluído",
  ERROR: "Erro",
};

const STATUS_CLASS: Record<string, string> = {
  QUEUED: "border-border bg-elevated text-muted",
  RUNNING: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  DONE: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  ERROR: "border-red-400/30 bg-red-400/10 text-red-300",
};

type Group = {
  key: string;
  workId: number | null;
  title: string;
  slug: string | null;
  items: DownloadItem[];
  updatedAt: number;
};

function groupByWork(items: DownloadItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    const key = item.workId == null ? "none" : String(item.workId);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        workId: item.workId,
        title:
          item.workId == null ? "Sem obra" : item.workTitle || `Obra ${item.workId}`,
        slug: item.workSlug,
        items: [],
        updatedAt: 0,
      };
      map.set(key, group);
    }
    group.items.push(item);
    if (!group.slug && item.workSlug) group.slug = item.workSlug;
    const stamp = Date.parse(item.updatedAt);
    if (Number.isFinite(stamp) && stamp > group.updatedAt) group.updatedAt = stamp;
  }
  const groups = [...map.values()];
  for (const group of groups) {
    group.items.sort((a, b) => a.chapterNumber - b.chapterNumber || a.chapterId - b.chapterId);
  }
  groups.sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}

export default function DownloadsPanel() {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const { data, isLoading, mutate } = useSWR<Snapshot>("/api/download", fetcher, {
    refreshInterval: (latest) =>
      latest?.items?.some((i) => i.status === "QUEUED" || i.status === "RUNNING")
        ? 3000
        : 20000,
    keepPreviousData: true,
  });

  const items = data?.items ?? [];
  const storage = data?.storage;
  const usedPercent =
    storage && storage.diskTotal > 0 ? (storage.diskUsed / storage.diskTotal) * 100 : 0;

  async function remove(query: string, busyKey: string, drop: (item: DownloadItem) => boolean) {
    if (busy[busyKey]) return;
    setBusy((prev) => ({ ...prev, [busyKey]: true }));
    try {
      await fetch(`/api/download?${query}`, { method: "DELETE" });
      await mutate(
        (current) =>
          current ? { ...current, items: current.items.filter((i) => !drop(i)) } : current,
        { revalidate: true },
      );
    } catch {
      /* the list refreshes on the next poll */
    } finally {
      setBusy((prev) => ({ ...prev, [busyKey]: false }));
    }
  }

  const removeChapter = (chapterId: number) =>
    remove(`chapterId=${chapterId}`, `c${chapterId}`, (i) => i.chapterId === chapterId);

  const removeGroup = (group: Group) =>
    group.workId == null
      ? removeLooseGroup(group)
      : remove(`workId=${group.workId}`, `w${group.workId}`, (i) => i.workId === group.workId);

  async function removeLooseGroup(group: Group) {
    const key = "wnone";
    if (busy[key]) return;
    setBusy((prev) => ({ ...prev, [key]: true }));
    try {
      for (const item of group.items) {
        await fetch(`/api/download?chapterId=${item.chapterId}`, { method: "DELETE" });
      }
      await mutate();
    } catch {
      /* the list refreshes on the next poll */
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  }

  const groups = groupByWork(items);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-text">
            Downloads ocupam {bytes(storage?.downloadsBytes)}
          </p>
          <span className="text-[11px] tabular-nums text-muted">
            {storage?.chapters ?? 0} capítulo(s)
          </span>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, usedPercent))}%` }}
          />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px] tabular-nums text-muted">
          <span>{bytes(storage?.diskFree)} livres</span>
          <span>{pct(usedPercent)} em uso</span>
          <span>de {bytes(storage?.diskTotal)}</span>
        </div>
      </section>

      {isLoading && !data ? (
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded bg-elevated" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-elevated/60" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">Nenhum capítulo baixado ainda.</p>
          <Link
            href="/library"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Ir para a biblioteca
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="rounded-xl border border-border bg-surface">
              <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                <div className="min-w-0">
                  {group.slug ? (
                    <Link
                      href={`/work/${group.slug}`}
                      className="block truncate text-sm font-medium text-text hover:text-accent"
                    >
                      {group.title}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium text-text">{group.title}</p>
                  )}
                  <p className="text-[11px] text-muted">{group.items.length} capítulo(s)</p>
                </div>
                <button
                  onClick={() => removeGroup(group)}
                  disabled={!!busy[group.workId == null ? "wnone" : `w${group.workId}`]}
                  className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:text-red-300 disabled:opacity-60"
                >
                  Remover todos
                </button>
              </header>

              <ul className="divide-y divide-border">
                {group.items.map((item) => {
                  const label = STATUS_LABELS[item.status] ?? item.status;
                  const name = item.chapterName?.trim() || `Cap. ${item.chapterNumber}`;
                  return (
                    <li key={item.chapterId} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text">{name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${
                              STATUS_CLASS[item.status] ?? STATUS_CLASS.QUEUED
                            }`}
                          >
                            {label}
                          </span>
                          {item.status === "RUNNING" || item.status === "QUEUED" ? (
                            <span className="tabular-nums">
                              {item.pagesDone}/{item.pageCount} páginas
                            </span>
                          ) : null}
                          {item.status === "DONE" ? (
                            <span className="tabular-nums">{bytes(item.bytes)}</span>
                          ) : null}
                          {item.error ? (
                            <span className="text-red-300">{item.error}</span>
                          ) : null}
                        </div>
                      </div>

                      {item.status === "DONE" ? (
                        <Link
                          href={`/reader/${item.chapterId}`}
                          className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:text-accent"
                        >
                          Abrir
                        </Link>
                      ) : null}
                      <button
                        onClick={() => removeChapter(item.chapterId)}
                        disabled={!!busy[`c${item.chapterId}`]}
                        className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:text-red-300 disabled:opacity-60"
                      >
                        Remover
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
