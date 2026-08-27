"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ListFilter } from "lucide-react";

type BulkChapter = { chapterId: number; name: string; number: number };

type DownloadReply = { queued?: number; blocked?: string };

const BATCH_SIZE = 100;
const BTN =
  "flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted hover:bg-elevated disabled:opacity-60";
const SELECT =
  "min-w-0 max-w-[12rem] flex-1 rounded-lg border border-border bg-elevated px-2 py-1.5 text-xs text-text disabled:opacity-60";

function optionLabel(chapter: BulkChapter): string {
  return chapter.name?.trim() ? chapter.name : `Cap. ${chapter.number}`;
}

export default function BulkDownloadBar({
  chapters,
  mangaId,
  workId,
}: {
  chapters: BulkChapter[];
  mangaId: number;
  workId: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "confirm" | "range">("idle");
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  if (chapters.length === 0) return null;

  const fromIndex = chapters.findIndex((c) => c.chapterId === fromId);
  const toIndex = chapters.findIndex((c) => c.chapterId === toId);
  const a = fromIndex >= 0 ? fromIndex : 0;
  const b = toIndex >= 0 ? toIndex : chapters.length - 1;
  const rangeChapters = chapters.slice(Math.min(a, b), Math.max(a, b) + 1);
  const sendingLabel = `Enviando ${sent}/${total}…`;

  async function send(list: BulkChapter[]) {
    if (sending || list.length === 0) return;
    setSending(true);
    setResult(null);
    setSent(0);
    setTotal(list.length);

    let queued = 0;
    let failed = false;
    let blocked = false;

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const block = list.slice(i, i + BATCH_SIZE);
      let data: DownloadReply | null = null;
      try {
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workId, mangaId, chapters: block }),
        });
        if (!res.ok) {
          failed = true;
          break;
        }
        data = (await res.json().catch(() => null)) as DownloadReply | null;
      } catch {
        failed = true;
        break;
      }
      if (data?.blocked === "quota") {
        blocked = true;
        break;
      }
      const n = Number(data?.queued);
      queued += Number.isFinite(n) ? n : 0;
      setSent(i + block.length);
    }

    setSending(false);
    if (blocked) setResult("Cota cheia — libere espaço em Downloads");
    else if (failed) setResult("Falhou ao enviar");
    else {
      setResult(`${queued} na fila`);
      setMode((m) => (m === "confirm" ? "idle" : m));
    }
    router.refresh();
  }

  return (
    <div className="mb-3 space-y-2">
      {mode === "confirm" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Baixar {chapters.length} capítulos?</span>
          <button type="button" onClick={() => send(chapters)} disabled={sending} className={BTN}>
            {sending ? sendingLabel : "Confirmar"}
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            disabled={sending}
            className={BTN}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("confirm")}
            disabled={sending}
            className={BTN}
          >
            <Download className="h-3.5 w-3.5" />
            Baixar tudo ({chapters.length})
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "range" ? "idle" : "range")}
            disabled={sending}
            className={BTN}
          >
            <ListFilter className="h-3.5 w-3.5" />
            Escolher intervalo
          </button>
        </div>
      )}

      {mode === "range" ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted">
              de
              <select
                value={chapters[a].chapterId}
                onChange={(e) => setFromId(Number(e.target.value))}
                disabled={sending}
                aria-label="de"
                className={SELECT}
              >
                {chapters.map((c) => (
                  <option key={c.chapterId} value={c.chapterId}>
                    {optionLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted">
              até
              <select
                value={chapters[b].chapterId}
                onChange={(e) => setToId(Number(e.target.value))}
                disabled={sending}
                aria-label="até"
                className={SELECT}
              >
                {chapters.map((c) => (
                  <option key={c.chapterId} value={c.chapterId}>
                    {optionLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => send(rangeChapters)}
            disabled={sending || rangeChapters.length === 0}
            className={BTN}
          >
            <Download className="h-3.5 w-3.5" />
            {sending ? sendingLabel : `Baixar ${rangeChapters.length} capítulos`}
          </button>
        </div>
      ) : null}

      {result ? <p className="text-[11px] text-muted">{result}</p> : null}
    </div>
  );
}
