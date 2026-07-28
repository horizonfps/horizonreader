"use client";

import { ArrowDown, ArrowUp, HardDrive, RotateCcw } from "lucide-react";
import type { ContainerMetrics } from "@/lib/metrics/docker";
import { Bar, Card, Pill, bytes, count, duration, pct, toneFor, type Tone } from "./ui";

// A stopped one-off container is not a failure; a stopped `restart: always` one
// is. The panel's overall verdict uses the same rule.
export function isExpectedUp(c: ContainerMetrics): boolean {
  return c.restartPolicy === "always" || c.restartPolicy === "unless-stopped";
}

export function isFailing(c: ContainerMetrics): boolean {
  if (c.health === "unhealthy" || c.oomKilled) return true;
  if (c.state === "restarting") return true;
  return c.state !== "running" && isExpectedUp(c);
}

function stateTone(c: ContainerMetrics): Tone {
  if (isFailing(c)) return "bad";
  if (c.state !== "running") return "idle";
  if (c.health === "starting" || c.restartCount > 3) return "warn";
  return "ok";
}

function stateLabel(c: ContainerMetrics): string {
  const base =
    c.state === "running"
      ? "rodando"
      : c.state === "exited"
        ? `parado (exit ${c.exitCode ?? "?"})`
        : c.state === "restarting"
          ? "reiniciando"
          : c.state;
  if (c.health && c.health !== "none") {
    const health = { healthy: "saudável", unhealthy: "não saudável", starting: "iniciando" }[c.health] || c.health;
    return `${base} · ${health}`;
  }
  return base;
}

export default function ContainersPanel({
  containers,
  cores,
  error,
}: {
  containers: ContainerMetrics[];
  cores: number;
  error: string | null;
}) {
  const capacity = Math.max(1, cores) * 100;

  return (
    <Card
      title="Containers"
      action={
        <span className="text-[11px] tabular-nums text-muted">
          {containers.filter((c) => c.state === "running").length}/{containers.length} de pé
        </span>
      }
    >
      {error ? (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-300">
          Docker inacessível: {error}
        </p>
      ) : null}

      {!error && !containers.length ? <p className="text-xs text-muted">Nenhum container encontrado.</p> : null}

      <div className="space-y-2">
        {containers.map((c) => {
          const tone = stateTone(c);
          const cpuTone = toneFor(c.cpuPercent, capacity * 0.5, capacity * 0.8);
          const memTone = toneFor(c.memPercent, 80, 92);
          return (
            <div key={c.id} className="rounded-lg border border-border bg-elevated/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-text">{c.name}</span>
                  <Pill tone={tone}>{stateLabel(c)}</Pill>
                </div>
                <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted">
                  {c.restartCount > 0 ? (
                    <span className={`flex items-center gap-1 ${c.restartCount > 3 ? "text-amber-400" : ""}`}>
                      <RotateCcw className="h-3 w-3" />
                      {c.restartCount} restart{c.restartCount > 1 ? "s" : ""}
                    </span>
                  ) : null}
                  {c.oomKilled ? <span className="text-red-400">OOM killed</span> : null}
                  <span>{c.state === "running" ? duration(c.uptimeSeconds) : c.status}</span>
                </div>
              </div>

              <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{c.image}</p>

              {c.state === "running" ? (
                <>
                  <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <div className="flex items-baseline justify-between text-[11px] text-muted">
                        <span>CPU</span>
                        <span className="tabular-nums text-text">{pct(c.cpuPercent, 1)}</span>
                      </div>
                      <Bar value={((c.cpuPercent ?? 0) / capacity) * 100} tone={cpuTone} className="mt-1" />
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between text-[11px] text-muted">
                        <span>Memória</span>
                        <span className="tabular-nums text-text">
                          {bytes(c.memUsed)} / {bytes(c.memLimit)} · {pct(c.memPercent)}
                        </span>
                      </div>
                      <Bar value={c.memPercent ?? 0} tone={memTone} className="mt-1" />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted">
                    <span className="flex items-center gap-1">
                      <ArrowDown className="h-3 w-3" />
                      {bytes(c.netRx)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowUp className="h-3 w-3" />
                      {bytes(c.netTx)}
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {bytes(c.blockRead)} lidos · {bytes(c.blockWrite)} escritos
                    </span>
                    <span>{count(c.pids)} pids</span>
                  </div>
                </>
              ) : null}

              {c.error ? <p className="mt-2 text-[11px] text-red-300">{c.error}</p> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
