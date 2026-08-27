"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BTN = "rounded-lg border border-border px-3 py-2 text-xs text-muted";

export default function UndoAutoReadButton({
  workId,
  mangaId,
  count,
}: {
  workId: number;
  mangaId: number;
  count: number;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (count <= 0) return null;

  async function undo(scoped: boolean) {
    setBusy(true);
    setMessage(null);
    const url = scoped
      ? `/api/progress/auto?workId=${workId}&mangaId=${mangaId}`
      : "/api/progress/auto";
    try {
      const res = await fetch(url, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; removed?: number }
        | null;
      if (!res.ok || !data?.ok) throw new Error("failed");
      setAsking(false);
      setMessage(`${data.removed ?? 0} desmarcados`);
      router.refresh();
    } catch {
      setAsking(false);
      setMessage("Não deu para desmarcar");
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAsking(true)} disabled={busy} className={BTN}>
          Desmarcar {count} lidos automáticos
        </button>
        {message ? <span className="text-xs text-muted">{message}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">Desmarcar onde?</span>
      <button type="button" onClick={() => undo(true)} disabled={busy} className={BTN}>
        {busy ? "Desmarcando…" : "Só nesta obra"}
      </button>
      <button type="button" onClick={() => undo(false)} disabled={busy} className={BTN}>
        {busy ? "Desmarcando…" : "Em todas as obras"}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        disabled={busy}
        className={BTN}
      >
        Cancelar
      </button>
    </div>
  );
}
