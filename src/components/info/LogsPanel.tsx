"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import type { ContainerLogSummary, LogEntry, LogGroup, LogLevel } from "@/lib/metrics/logs";
import { Card, Pill, clock, count } from "./ui";

type Payload = {
  generatedAt: string;
  tail: number;
  containers: ContainerLogSummary[];
  entries: LogEntry[];
  groups: LogGroup[];
  error?: string;
};

const fetcher = (url: string): Promise<Payload> => fetch(url).then((r) => r.json());

const LEVEL_STYLE: Record<LogLevel, string> = {
  error: "text-red-300",
  warn: "text-amber-300",
  info: "text-muted",
  debug: "text-muted/60",
};

const LEVEL_TAG: Record<LogLevel, string> = {
  error: "bg-red-400/15 text-red-300",
  warn: "bg-amber-400/15 text-amber-300",
  info: "bg-elevated text-muted",
  debug: "bg-elevated text-muted/60",
};

const TAILS = [100, 250, 500, 1000];

export default function LogsPanel({ paused }: { paused: boolean }) {
  const [container, setContainer] = useState("");
  const [minLevel, setMinLevel] = useState<"all" | "warn" | "error">("error");
  const [tail, setTail] = useState(250);

  const query = new URLSearchParams({ tail: String(tail) });
  if (container) query.set("container", container);

  const { data, isLoading, error } = useSWR<Payload>(`/api/info/logs?${query}`, fetcher, {
    refreshInterval: paused ? 0 : 20_000,
    keepPreviousData: true,
  });

  const entries = (data?.entries || [])
    .filter((e) => (minLevel === "all" ? true : minLevel === "warn" ? e.level !== "info" && e.level !== "debug" : e.level === "error"))
    .slice(-400)
    .reverse();

  const totalErrors = (data?.containers || []).reduce((acc, c) => acc + c.error, 0);
  const totalWarns = (data?.containers || []).reduce((acc, c) => acc + c.warn, 0);

  const select = "rounded-md border border-border bg-elevated px-2 py-1 text-[11px] text-text outline-none";

  return (
    <Card
      title="Logs e erros"
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin text-muted" /> : null}
          <select className={select} value={container} onChange={(e) => setContainer(e.target.value)}>
            <option value="">todos os containers</option>
            {(data?.containers || []).map((c) => (
              <option key={c.container} value={c.container}>
                {c.container}
              </option>
            ))}
          </select>
          <select className={select} value={minLevel} onChange={(e) => setMinLevel(e.target.value as typeof minLevel)}>
            <option value="error">só erros</option>
            <option value="warn">erros + avisos</option>
            <option value="all">tudo</option>
          </select>
          <select className={select} value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {TAILS.map((t) => (
              <option key={t} value={t}>
                {t} linhas
              </option>
            ))}
          </select>
        </div>
      }
    >
      {error || data?.error ? (
        <p className="mb-3 rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-300">
          Não foi possível ler os logs: {data?.error || String(error)}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill tone={totalErrors ? "bad" : "ok"}>
          {count(totalErrors)} erro{totalErrors === 1 ? "" : "s"}
        </Pill>
        <Pill tone={totalWarns ? "warn" : "ok"}>{count(totalWarns)} avisos</Pill>
        <span className="text-[11px] text-muted">nas últimas {tail} linhas de cada container</span>
      </div>

      <div className="mb-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {(data?.containers || []).map((c) => (
          <button
            key={c.container}
            onClick={() => setContainer(container === c.container ? "" : c.container)}
            className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
              container === c.container ? "border-accent/40 bg-accent/5" : "border-border bg-elevated/40 hover:border-border"
            }`}
          >
            <span className="min-w-0 truncate text-text">{c.container}</span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums">
              {c.error > 0 ? (
                <span className="flex items-center gap-1 text-red-300">
                  <XCircle className="h-3 w-3" />
                  {c.error}
                </span>
              ) : null}
              {c.warn > 0 ? (
                <span className="flex items-center gap-1 text-amber-300">
                  <AlertTriangle className="h-3 w-3" />
                  {c.warn}
                </span>
              ) : null}
              <span className="text-muted">{c.failed ? "sem acesso" : `${c.lines} linhas`}</span>
            </span>
          </button>
        ))}
      </div>

      {data?.groups?.length ? (
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Erros recorrentes</p>
          <div className="space-y-1">
            {data.groups.map((g) => (
              <div key={g.signature} className="flex items-start gap-2 rounded-lg border border-border bg-elevated/40 px-2.5 py-1.5">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${LEVEL_TAG[g.level]}`}>
                  {g.count}×
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-mono text-[11px] ${LEVEL_STYLE[g.level]}`}>{g.sample}</p>
                  <p className="text-[10px] text-muted">
                    {g.container} · último {clock(g.lastAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-black/60 p-2 font-mono text-[11px] leading-relaxed">
        {entries.length ? (
          entries.map((e, i) => (
            <div key={`${e.at}-${i}`} className="flex gap-2 whitespace-pre-wrap break-words py-0.5">
              <span className="shrink-0 text-muted/70">{clock(e.at)}</span>
              <span className="w-[9rem] shrink-0 truncate text-accent/70">{e.container}</span>
              <span className={`min-w-0 flex-1 ${LEVEL_STYLE[e.level]}`}>{e.message}</span>
            </div>
          ))
        ) : (
          <p className="p-2 text-muted">
            {isLoading ? "Carregando…" : "Nenhuma linha para este filtro — nada quebrado por aqui."}
          </p>
        )}
      </div>
    </Card>
  );
}
