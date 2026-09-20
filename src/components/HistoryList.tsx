"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Trash2, X } from "lucide-react";
import { coverProxy } from "@/lib/cards";
import { timeAgo } from "@/lib/labels";
import { formatChapterNumber } from "@/lib/continueReading";

export type HistoryEntry = {
  id: number;
  chapterId: number;
  chapterNumber: number;
  lastPageRead: number;
  readAt: string;
  work: { slug: string; title: string; coverUrl: string | null };
};

const DAY_MS = 86_400_000;

function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((start.getTime() - d.getTime()) / DAY_MS);
  if (d.getTime() >= start.getTime()) return "Hoje";
  if (diff <= 0) return "Ontem";
  if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" });
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: d.getFullYear() !== start.getFullYear() ? "numeric" : undefined });
}

export default function HistoryList({ entries, now }: { entries: HistoryEntry[]; now: number }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const visible = entries.filter((e) => !hidden.has(e.id));

  async function remove(id: number) {
    setHidden((s) => new Set(s).add(id));
    await fetch(`/api/history?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function clearAll() {
    if (!confirm("Apagar todo o histórico de leitura?")) return;
    setBusy(true);
    await fetch("/api/history", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  const header = (
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Histórico</h1>
      {visible.length ? (
        <button
          type="button"
          onClick={clearAll}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:bg-elevated hover:text-text disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Limpar histórico
        </button>
      ) : null}
    </div>
  );

  if (!visible.length) {
    return (
      <div className="space-y-4">
        {header}
        <p className="py-16 text-center text-sm text-muted">Os capítulos que você abrir aparecem aqui.</p>
      </div>
    );
  }

  const groups: { label: string; items: HistoryEntry[] }[] = [];
  for (const e of visible) {
    const label = dayLabel(e.readAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div className="space-y-6">
      {header}
      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{g.label}</h2>
          <ul className="grid gap-1 md:grid-cols-2 2xl:grid-cols-3">
            {g.items.map((e) => {
              const src = coverProxy(e.work.coverUrl);
              const cap = e.chapterNumber > 0 ? `Cap. ${formatChapterNumber(e.chapterNumber)}` : "Capítulo";
              return (
                <li key={e.id} className="group flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-surface">
                  <Link href={`/work/${e.work.slug}`} className="h-16 w-11 shrink-0 overflow-hidden rounded bg-elevated">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" loading="lazy" draggable={false} className="cover-img h-full w-full object-cover" />
                    ) : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/work/${e.work.slug}`} className="block truncate text-sm font-medium text-text hover:text-accent">
                      {e.work.title}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {cap}
                      {e.lastPageRead > 0 ? ` · pág. ${e.lastPageRead + 1}` : ""}
                      {" · "}
                      {timeAgo(e.readAt, now)}
                    </p>
                  </div>
                  <Link
                    href={`/reader/${e.chapterId}`}
                    aria-label={`Abrir ${cap}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-text hover:bg-accent hover:text-on-accent"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    aria-label="Remover do histórico"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-elevated hover:text-text focus:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
