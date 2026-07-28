"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, Cpu, Pause, Play, RefreshCw } from "lucide-react";
import type { ContainerMetrics, DockerInfo } from "@/lib/metrics/docker";
import type { HostMetrics } from "@/lib/metrics/host";
import type { ServicesSnapshot } from "@/lib/metrics/services";
import ContainersPanel, { isFailing } from "./ContainersPanel";
import LogsPanel from "./LogsPanel";
import ServicesPanel from "./ServicesPanel";
import {
  Bar,
  Card,
  Pill,
  Ring,
  Sparkline,
  Stat,
  bytes,
  clock,
  duration,
  pct,
  rate,
  toneFor,
  type Tone,
} from "./ui";

type MetricsPayload = {
  generatedAt: string;
  host: HostMetrics | { available: false; procPath: null };
  containers: ContainerMetrics[];
  containersError: string | null;
  docker: DockerInfo | null;
  dockerError: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const HISTORY = 60;

function push(list: number[], value: number): number[] {
  const next = [...list, value];
  return next.length > HISTORY ? next.slice(next.length - HISTORY) : next;
}

export default function InfoDashboard() {
  const [paused, setPaused] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const lastStamp = useRef<string | null>(null);

  const metrics = useSWR<MetricsPayload>("/api/info/metrics", fetcher, {
    refreshInterval: paused ? 0 : 5_000,
    keepPreviousData: true,
  });
  const services = useSWR<ServicesSnapshot & { generatedAt: string }>("/api/info/services", fetcher, {
    refreshInterval: paused ? 0 : 30_000,
    keepPreviousData: true,
  });

  const data = metrics.data;
  const host = data?.host;

  useEffect(() => {
    if (!data || !host?.available || data.generatedAt === lastStamp.current) return;
    lastStamp.current = data.generatedAt;
    setCpuHistory((prev) => push(prev, host.cpu.total));
    const memPercent = host.memory.total ? (host.memory.used / host.memory.total) * 100 : 0;
    setMemHistory((prev) => push(prev, memPercent));
  }, [data, host]);

  const memPercent = host?.available && host.memory.total ? (host.memory.used / host.memory.total) * 100 : null;
  const swapPercent = host?.available && host.memory.swapTotal ? (host.memory.swapUsed / host.memory.swapTotal) * 100 : null;
  const diskPercent = host?.available && host.disk ? (host.disk.used / host.disk.total) * 100 : null;
  const cpuPercent = host?.available ? host.cpu.total : null;
  const cores = host?.available ? host.cores || data?.docker?.NCPU || 0 : data?.docker?.NCPU || 0;

  const cpuTone = toneFor(cpuPercent, 65, 88);
  const memTone = toneFor(memPercent, 78, 92);
  const diskTone = toneFor(diskPercent, 75, 90);
  const swapTone = toneFor(swapPercent, 25, 60);

  const badContainers = (data?.containers || []).filter(isFailing);
  const overall: Tone =
    !data || (!host?.available && data.dockerError)
      ? "idle"
      : badContainers.length || cpuTone === "bad" || memTone === "bad" || diskTone === "bad"
        ? "bad"
        : cpuTone === "warn" || memTone === "warn" || diskTone === "warn" || swapTone !== "ok"
          ? "warn"
          : "ok";

  const overallLabel = { ok: "tudo saudável", warn: "atenção", bad: "degradado", idle: "sem dados" }[overall];

  const alerts: string[] = [];
  for (const c of badContainers) {
    alerts.push(
      c.state === "restarting"
        ? `container ${c.name} reiniciando em loop (${c.restartCount} vezes)`
        : c.health === "unhealthy"
          ? `container ${c.name} marcado como não saudável`
          : c.oomKilled
            ? `container ${c.name} morto por falta de memória`
            : `container ${c.name} fora do ar`,
    );
  }
  if (cpuTone === "bad") alerts.push(`CPU em ${pct(cpuPercent)}`);
  if (memTone === "bad") alerts.push(`memória em ${pct(memPercent)}`);
  if (diskTone === "bad") alerts.push(`disco em ${pct(diskPercent)}`);
  if (swapPercent != null && swapPercent > 25) alerts.push(`swap em uso (${pct(swapPercent)})`);
  if (services.data) {
    if (!services.data.suwayomi.ok) alerts.push("engine Suwayomi não respondeu");
    for (const solver of services.data.solvers) if (!solver.ok) alerts.push(`solver ${solver.name} offline`);
    if (!services.data.tunnel.ok) alerts.push("conector do túnel não encontrado no host");
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-text">Infra · HorizonReader</h1>
            <Pill tone={overall}>{overallLabel}</Pill>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted">
            {host?.available ? host.hostname : "host desconhecido"}
            {host?.available && host.kernel ? ` · kernel ${host.kernel}` : ""}
            {data?.docker ? ` · docker ${data.docker.ServerVersion}` : ""}
            {host?.available ? ` · no ar ${duration(host.uptimeSeconds)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted">
            {data ? `atualizado ${clock(data.generatedAt)}` : "carregando…"}
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[11px] text-text transition-colors hover:border-accent/40"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "retomar" : "pausar"}
          </button>
          <button
            onClick={() => {
              void metrics.mutate();
              void services.mutate();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-[11px] text-text transition-colors hover:border-accent/40"
          >
            <RefreshCw className={`h-3 w-3 ${metrics.isValidating ? "animate-spin" : ""}`} />
            atualizar
          </button>
        </div>
      </header>

      {host && !host.available ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
          O /proc do host não está montado no container, então as métricas da máquina não aparecem. Suba o compose
          atualizado na VPS (<span className="font-mono">docker compose up -d --build web</span>).
        </p>
      ) : null}

      {alerts.length ? (
        <Card title={`Alertas (${alerts.length})`} className="border-red-400/30 bg-red-400/[0.03]">
          <ul className="space-y-1">
            {alerts.map((alert) => (
              <li key={alert} className="flex items-start gap-2 text-xs text-red-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                {alert}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <Ring
            value={cpuPercent}
            tone={cpuTone}
            label="CPU"
            caption={cores ? `${cores} núcleos` : undefined}
          />
        </Card>
        <Card>
          <Ring
            value={memPercent}
            tone={memTone}
            label="Memória"
            caption={host?.available ? `${bytes(host.memory.used)} / ${bytes(host.memory.total)}` : undefined}
          />
        </Card>
        <Card>
          <Ring
            value={diskPercent}
            tone={diskTone}
            label="Disco"
            caption={host?.available && host.disk ? `${bytes(host.disk.free)} livres` : undefined}
          />
        </Card>
        <Card>
          <Ring
            value={swapPercent}
            tone={swapTone}
            label="Swap"
            caption={host?.available ? `${bytes(host.memory.swapUsed)} / ${bytes(host.memory.swapTotal)}` : undefined}
          />
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="CPU nos últimos minutos" className="lg:col-span-2">
          {!host?.available ? <p className="text-xs text-muted">Indisponível.</p> : null}
          <Sparkline points={cpuHistory} tone={cpuTone} />
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted">
            {host?.available
              ? [
                  ["usuário", host.cpu.modes.user],
                  ["sistema", host.cpu.modes.system],
                  ["iowait", host.cpu.modes.iowait],
                  ["steal", host.cpu.modes.steal],
                ].map(([label, value]) => (
                  <span key={String(label)}>
                    {label} <span className="text-text">{pct(value as number, 1)}</span>
                  </span>
                ))
              : null}
          </div>
          <div className="mt-3">
            <p className="mb-1 text-[11px] uppercase tracking-wider text-muted">Memória</p>
            <Sparkline points={memHistory} tone={memTone} />
          </div>
        </Card>

        <Card title="Carga do sistema">
          {host?.available ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["1 min", host.load.one],
                    ["5 min", host.load.five],
                    ["15 min", host.load.fifteen],
                  ] as const
                ).map(([label, value]) => {
                  const perCore = cores ? (value / cores) * 100 : 0;
                  return (
                    <div key={label}>
                      <Stat
                        label={label}
                        value={value.toFixed(2)}
                        tone={toneFor(perCore, 80, 120)}
                        sub={`${pct(perCore)} da CPU`}
                      />
                      <Bar value={Math.min(100, perCore)} tone={toneFor(perCore, 80, 120)} className="mt-1.5" />
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
                <Cpu className="h-3 w-3" />
                {host.load.running} de {host.load.total} processos executando
              </p>
              <p className="mt-1 truncate text-[11px] text-muted">{host.cpuModel || "—"}</p>
            </>
          ) : (
            <p className="text-xs text-muted">Indisponível.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Núcleos">
          {host?.available && host.cpu.cores.length ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {host.cpu.cores.map((value, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[11px] tabular-nums text-muted">#{i}</span>
                  <Bar value={value} tone={toneFor(value, 70, 90)} />
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">{pct(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">Indisponível.</p>
          )}
        </Card>

        <Card title="Rede e disco">
          {host?.available ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Download"
                  value={rate(host.net.rxRate)}
                  sub={<span className="flex items-center gap-1"><ArrowDown className="h-3 w-3" />entrada</span>}
                />
                <Stat
                  label="Upload"
                  value={rate(host.net.txRate)}
                  sub={<span className="flex items-center gap-1"><ArrowUp className="h-3 w-3" />saída</span>}
                />
                <Stat label="Leitura em disco" value={rate(host.diskIo.readRate)} />
                <Stat label="Escrita em disco" value={rate(host.diskIo.writeRate)} />
              </div>
              <div className="mt-3 space-y-1">
                {host.net.interfaces.slice(0, 4).map((nic) => (
                  <div key={nic.name} className="flex items-center justify-between text-[11px] tabular-nums text-muted">
                    <span className="font-mono">{nic.name}</span>
                    <span>
                      ↓ {bytes(nic.rxBytes)} · ↑ {bytes(nic.txBytes)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">Indisponível.</p>
          )}
        </Card>

        <Card title="Pressão de recursos (PSI)">
          {host?.available && host.pressure.cpu ? (
            <div className="space-y-3">
              {(
                [
                  ["CPU", host.pressure.cpu],
                  ["I/O", host.pressure.io],
                  ["Memória", host.pressure.memory],
                ] as const
              ).map(([label, psi]) => {
                const value = psi?.some10 ?? 0;
                return (
                  <div key={label}>
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="text-muted">{label}</span>
                      <span className="tabular-nums text-text">
                        {pct(value, 1)} <span className="text-muted">10s</span> · {pct(psi?.some60 ?? 0, 1)}{" "}
                        <span className="text-muted">60s</span>
                      </span>
                    </div>
                    <Bar value={value} tone={toneFor(value, 10, 40)} className="mt-1" />
                  </div>
                );
              })}
              <p className="flex items-start gap-1.5 text-[11px] text-muted">
                <Activity className="mt-0.5 h-3 w-3 shrink-0" />
                Percentual do tempo em que alguma tarefa ficou parada esperando o recurso.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">Indisponível.</p>
          )}
        </Card>
      </div>

      <ContainersPanel
        containers={data?.containers || []}
        cores={cores}
        error={data?.dockerError || data?.containersError || null}
      />

      {services.data ? <ServicesPanel services={services.data} /> : null}

      <LogsPanel paused={paused} />
    </div>
  );
}
