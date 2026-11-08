"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import Username from "@/components/Username";
import { timeAgo } from "@/lib/labels";

export type InviteRow = {
  id: number;
  code: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: { username: string; displayName: string | null; isAdmin: boolean } | null;
};

const DAY = 24 * 60 * 60 * 1000;

function expiresIn(iso: string, now: number): string {
  const days = Math.ceil((new Date(iso).getTime() - now) / DAY);
  return days <= 1 ? "expira hoje" : `expira em ${days} dias`;
}

export default function InviteManager({
  initial,
  limit,
  now,
}: {
  initial: InviteRow[];
  limit: number | null;
  now: number;
}) {
  const [invites, setInvites] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (copied == null) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const pending = invites.filter((i) => !i.usedAt && new Date(i.expiresAt).getTime() > now);
  const used = invites.filter((i) => i.usedAt);
  const left = limit == null ? null : Math.max(0, limit - pending.length);

  async function create() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/invites", { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok || !data?.invite) {
      setError(data?.error === "limit_reached" ? "Limite de convites pendentes atingido." : "Falha ao gerar.");
      return;
    }
    const row: InviteRow = {
      ...data.invite,
      createdAt: new Date().toISOString(),
      usedAt: null,
      usedBy: null,
    };
    setInvites((list) => [row, ...list]);
    void copy(row);
  }

  async function revoke(id: number) {
    setInvites((list) => list.filter((i) => i.id !== id));
    await fetch(`/api/invites?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function copy(row: InviteRow) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/invite/${row.code}`);
      setCopied(row.id);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Convites</h1>
        {left != null ? (
          <span className="text-sm text-muted">
            {left} de {limit} disponíveis
          </span>
        ) : null}
        <button
          type="button"
          onClick={create}
          disabled={busy || left === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Novo convite
        </button>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {pending.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface/60">
          {pending.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-text">/invite/{i.code}</p>
                <p className="text-xs text-muted">{expiresIn(i.expiresAt, now)}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(i)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-elevated hover:text-text"
              >
                {copied === i.id ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === i.id ? "Copiado" : "Copiar link"}
              </button>
              <button
                type="button"
                onClick={() => revoke(i.id)}
                aria-label="Revogar"
                className="rounded-lg p-1.5 text-muted hover:bg-elevated hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {used.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text">Convidados</h2>
          <ul className="space-y-1">
            {used.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                {i.usedBy ? (
                  <Link href={`/u/${encodeURIComponent(i.usedBy.username)}`} className="truncate hover:underline">
                    <Username name={i.usedBy.displayName || i.usedBy.username} isAdmin={i.usedBy.isAdmin} />
                    <span className="ml-1.5 text-muted">@{i.usedBy.username}</span>
                  </Link>
                ) : (
                  <span className="text-muted">conta removida</span>
                )}
                <span className="shrink-0 text-xs text-muted">{timeAgo(new Date(i.usedAt!), now)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
