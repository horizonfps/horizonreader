"use client";

import type { ServicesSnapshot } from "@/lib/metrics/services";
import { Bar, Card, Pill, Stat, ago, bytes, count, duration, pct, toneFor } from "./ui";

function ProbeRow({
  name,
  ok,
  latencyMs,
  detail,
  error,
  url,
}: {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string | null;
  error: string | null;
  url: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-text">{name}</span>
          <Pill tone={ok ? "ok" : "bad"}>{ok ? "online" : "offline"}</Pill>
        </div>
        <p className="truncate font-mono text-[11px] text-muted">{url || "—"}</p>
      </div>
      <div className="text-right">
        <p className="text-xs tabular-nums text-text">{latencyMs != null ? `${latencyMs} ms` : "—"}</p>
        <p className={`max-w-[22rem] truncate text-[11px] ${error ? "text-red-300" : "text-muted"}`}>
          {error || detail || "—"}
        </p>
      </div>
    </div>
  );
}

function HostPill({ host, right }: { host: string; right: string }) {
  return (
    <span className="rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] tabular-nums text-muted">
      {host} <span className="text-text">{right}</span>
    </span>
  );
}

export default function ServicesPanel({ services }: { services: ServicesSnapshot }) {
  const { suwayomi, solvers, solverEngines, front, storage, database, app } = services;
  const anySolve = solverEngines.engines.some((e) => e.ok + e.fail > 0);
  const cacheUsage = storage.imageCache.budgetBytes
    ? (storage.imageCache.bytes / storage.imageCache.budgetBytes) * 100
    : 0;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="Serviços">
        <ProbeRow {...suwayomi} />
        {solvers.map((s) => (
          <ProbeRow key={s.name} {...s} />
        ))}
        <ProbeRow {...front} />
      </Card>

      <Card title="Motores de desafio" className="lg:col-span-2">
        {anySolve ? (
          <div className="space-y-4">
            {solverEngines.engines.map((e) => (
              <div key={e.kind}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize text-text">{e.kind}</span>
                    <Pill tone={toneFor(e.successRate == null ? null : 100 - e.successRate, 25, 60)}>
                      {pct(e.successRate)} de acerto
                    </Pill>
                  </div>
                  <p className="text-[11px] tabular-nums text-muted">
                    {count(e.ok)} acertos · {count(e.fail)} falhas ·{" "}
                    {e.avgMs == null ? "—" : `${count(e.avgMs)} ms`}
                  </p>
                </div>
                <Bar
                  value={e.successRate ?? 0}
                  tone={toneFor(e.successRate == null ? null : 100 - e.successRate, 25, 60)}
                  className="mt-1.5"
                />
                {e.worstHosts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.worstHosts.map((h) => (
                      <HostPill key={h.host} host={h.host} right={`${h.fail} falhas`} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {solverEngines.hosts.length > 0 && (
              <div className="border-t border-border/60 pt-3">
                <p className="mb-1.5 text-[11px] text-muted">Quem está vencendo em cada site</p>
                <div className="flex flex-wrap gap-1.5">
                  {solverEngines.hosts.map((h) => (
                    <HostPill key={h.host} host={h.host} right={h.winner ?? "ninguém"} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Nenhum desafio resolvido ainda — o placar aparece depois das primeiras buscas.
          </p>
        )}
      </Card>

      <Card title="Engine (Suwayomi)">
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="GraphQL"
            value={suwayomi.graphql.ok ? `${suwayomi.graphql.latencyMs} ms` : "saturado"}
            tone={suwayomi.graphql.ok ? "ok" : "warn"}
            sub={suwayomi.graphql.error ?? "fila de buscas"}
          />
          <Stat
            label="Buscas em voo"
            value={`${suwayomi.graphql.gate.active}/${suwayomi.graphql.gate.limit}`}
            tone={suwayomi.graphql.gate.active >= suwayomi.graphql.gate.limit ? "warn" : "ok"}
          />
          <Stat label="Na fila" value={count(suwayomi.graphql.gate.waiting)} />
        </div>
        {suwayomi.extensions ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Extensões" value={count(suwayomi.extensions.installed)} sub="instaladas" />
              <Stat label="Fontes" value={count(suwayomi.sources)} sub="ativas" />
              <Stat
                label="Com update"
                value={count(suwayomi.extensions.updatable)}
                tone={suwayomi.extensions.updatable > 0 ? "warn" : "ok"}
              />
              <Stat
                label="Obsoletas"
                value={count(suwayomi.extensions.obsolete)}
                tone={suwayomi.extensions.obsolete > 0 ? "warn" : "ok"}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suwayomi.extensions.byLang.map((l) => (
                <span
                  key={l.lang}
                  className="rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] tabular-nums text-muted"
                >
                  {l.lang} <span className="text-text">{l.count}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">
              {suwayomi.extensions.available} extensões disponíveis no catálogo do repositório.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">Catálogo indisponível — engine fora do ar ou ainda carregando.</p>
        )}
      </Card>

      <Card title="Armazenamento">
        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted">Cache de imagens</span>
              <span className="tabular-nums text-text">
                {bytes(storage.imageCache.bytes)} / {bytes(storage.imageCache.budgetBytes)}
              </span>
            </div>
            <Bar value={cacheUsage} tone={toneFor(cacheUsage, 80, 95)} className="mt-1.5" />
            <p className="mt-1 text-[11px] text-muted">
              {count(storage.imageCache.files)} arquivos · limite em RAM {bytes(storage.imageCache.memBudgetBytes)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Banco (SQLite)"
              value={bytes(storage.database.bytes)}
              sub={storage.database.path || "—"}
            />
            <Stat
              label="Downloads"
              value={storage.downloads.exists ? bytes(storage.downloads.bytes) : "não montado"}
              sub={storage.downloads.exists ? `${count(storage.downloads.files)} arquivos` : storage.downloads.dir}
            />
          </div>
        </div>
      </Card>

      <Card title="Conteúdo e uso">
        {database ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            <Stat label="Usuários" value={count(database.users)} />
            <Stat label="Obras" value={count(database.works)} />
            <Stat label="Fontes ligadas" value={count(database.sourceLinks)} />
            <Stat label="Favoritos" value={count(database.favorites)} />
            <Stat label="Caps. lidos" value={count(database.history)} sub="total" />
            <Stat label="Últimas 24h" value={count(database.chaptersRead24h)} sub="capítulos" />
            <Stat label="7 dias" value={count(database.chaptersRead7d)} sub="capítulos" />
            <Stat label="Leitores 24h" value={count(database.activeReaders24h)} sub={ago(database.lastReadAt)} />
          </div>
        ) : (
          <p className="text-xs text-red-300">Falha ao consultar o banco.</p>
        )}
      </Card>

      <Card title="Runtime do app" className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Node" value={app.node} />
          <Stat label="Ambiente" value={app.env} />
          <Stat label="Uptime do processo" value={duration(app.uptimeSeconds)} />
          <Stat label="RSS" value={bytes(app.rssBytes)} sub={`heap ${bytes(app.heapUsedBytes)}`} />
          <Stat label="Fuso" value={app.timezone || "—"} />
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Cache em disco ocupa {pct(cacheUsage)} do orçamento configurado.
        </p>
      </Card>
    </div>
  );
}
