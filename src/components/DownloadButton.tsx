"use client";

import { useState } from "react";
import { Check, Download } from "lucide-react";

export type DownloadStatus = "QUEUED" | "RUNNING" | "DONE" | "ERROR";

export type DownloadChapter = { chapterId: number; name: string; number: number };

const LABELS: Record<DownloadStatus, string> = {
  QUEUED: "Na fila",
  RUNNING: "Baixando",
  DONE: "Baixado",
  ERROR: "Erro",
};

export default function DownloadButton({
  chapters,
  mangaId,
  workId,
  initialStatus = null,
  label,
}: {
  chapters: DownloadChapter[];
  mangaId: number;
  workId: number;
  initialStatus?: DownloadStatus | null;
  label?: string;
}) {
  const [status, setStatus] = useState<DownloadStatus | null>(initialStatus);
  const [queued, setQueued] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [quotaFull, setQuotaFull] = useState(false);
  const [userQuotaFull, setUserQuotaFull] = useState(false);

  async function send(e: React.MouseEvent) {
    // The chapter row is a link; the button must not navigate.
    e.preventDefault();
    e.stopPropagation();
    if (busy || !chapters.length) return;
    setBusy(true);
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId, mangaId, chapters }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as {
        queued?: number;
        blocked?: string | null;
      } | null;
      if (data?.blocked === "quota" || data?.blocked === "user_quota") {
        setQuotaFull(data.blocked === "quota");
        setUserQuotaFull(data.blocked === "user_quota");
      } else {
        setQuotaFull(false);
        setUserQuotaFull(false);
        setQueued(Number.isFinite(Number(data?.queued)) ? Number(data?.queued) : chapters.length);
        setStatus("QUEUED");
      }
    }
    setBusy(false);
  }

  const sent = queued !== null;
  const done = status === "DONE";
  const blocked = quotaFull || userQuotaFull;
  const disabled =
    busy || (!blocked && (done || sent || status === "QUEUED" || status === "RUNNING"));

  const text = userQuotaFull
    ? "Sua cota acabou"
    : quotaFull
      ? "Cota cheia"
      : label
        ? sent
          ? `Na fila (${queued})`
          : label
        : status
          ? LABELS[status]
          : "Baixar";

  const Icon = done ? Check : Download;

  return (
    <button
      type="button"
      onClick={send}
      disabled={disabled}
      aria-label={label ?? "Baixar capítulo"}
      className={
        label
          ? "flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted disabled:opacity-60"
          : "flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted disabled:opacity-60"
      }
    >
      <Icon className="h-4 w-4" />
      {busy ? "…" : text}
    </button>
  );
}
