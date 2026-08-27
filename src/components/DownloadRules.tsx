"use client";

import { useState } from "react";
import { bytes } from "@/components/info/ui";

export type Policy = {
  quotaMb: number;
  keepDays: number;
  minFreeGb: number;
  windowStart: string;
  windowEnd: string;
  paused: boolean;
};

const FIELD =
  "w-full rounded-lg border border-border bg-elevated px-2 py-1.5 text-sm text-text outline-none focus:border-accent";

function numberOf(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export default function DownloadRules({
  policy,
  onChanged,
}: {
  policy: Policy;
  onChanged: () => void;
}) {
  const [quotaMb, setQuotaMb] = useState(String(policy.quotaMb));
  const [keepDays, setKeepDays] = useState(String(policy.keepDays));
  const [minFreeGb, setMinFreeGb] = useState(String(policy.minFreeGb));
  const [windowStart, setWindowStart] = useState(policy.windowStart);
  const [windowEnd, setWindowEnd] = useState(policy.windowEnd);
  const [paused, setPaused] = useState(policy.paused);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((current) => (current === text ? null : current)), 4000);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/download/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quotaMb: numberOf(quotaMb),
          keepDays: numberOf(keepDays),
          minFreeGb: numberOf(minFreeGb),
          windowStart,
          windowEnd,
          paused,
        }),
      });
      if (res.ok) {
        flash("Salvo");
        onChanged();
      } else {
        flash("Não deu para salvar");
      }
    } catch {
      flash("Não deu para salvar");
    } finally {
      setSaving(false);
    }
  }

  async function cleanup() {
    if (cleaning) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/download/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cleanup" }),
      });
      const data = (await res.json().catch(() => null)) as {
        removed?: number;
        bytesFreed?: number;
      } | null;
      if (res.ok && data) {
        flash(
          `Apagados ${data.removed ?? 0} capítulo(s) · ${bytes(data.bytesFreed ?? 0)} liberados`,
        );
        onChanged();
      } else {
        flash("Não deu para liberar espaço");
      }
    } catch {
      flash("Não deu para liberar espaço");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-text">Regras de download</h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-muted">Cota de espaço (MB)</span>
          <input
            type="number"
            min="0"
            value={quotaMb}
            onChange={(e) => setQuotaMb(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
          <span className="mt-0.5 block text-[11px] text-muted">0 = sem limite</span>
        </label>

        <label className="block">
          <span className="text-[11px] text-muted">Apagar baixados com mais de (dias)</span>
          <input
            type="number"
            min="0"
            value={keepDays}
            onChange={(e) => setKeepDays(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
          <span className="mt-0.5 block text-[11px] text-muted">0 = nunca apagar</span>
        </label>

        <label className="block">
          <span className="text-[11px] text-muted">
            Avisar quando o espaço livre for menor que (GB)
          </span>
          <input
            type="number"
            min="0"
            value={minFreeGb}
            onChange={(e) => setMinFreeGb(e.target.value)}
            className={`mt-1 ${FIELD}`}
          />
        </label>

        <div className="block">
          <span className="text-[11px] text-muted">Baixar só entre</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="time"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className={FIELD}
            />
            <span className="text-[11px] text-muted">e</span>
            <input
              type="time"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className={FIELD}
            />
          </div>
          <span className="mt-0.5 block text-[11px] text-muted">vazio = qualquer horário</span>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={paused}
          onChange={(e) => setPaused(e.target.checked)}
          className="h-4 w-4 accent-[rgb(var(--accent))]"
        />
        <span className="text-sm text-text">Pausar downloads</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={cleanup}
          disabled={cleaning}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text disabled:opacity-60"
        >
          {cleaning ? "Liberando…" : "Liberar espaço agora"}
        </button>
        {message ? <span className="text-[11px] text-muted">{message}</span> : null}
      </div>
    </section>
  );
}
