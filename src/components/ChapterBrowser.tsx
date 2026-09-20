"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  EyeOff,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import DownloadButton, { type DownloadStatus } from "@/components/DownloadButton";
import BulkDownloadBar from "@/components/BulkDownloadBar";
import UndoAutoReadButton from "@/components/UndoAutoReadButton";
import SourcePicker, { type SourceOption } from "@/components/SourcePicker";
import { pickResumeChapter, formatChapterNumber, type ResumeKind } from "@/lib/continueReading";
import { timeAgo } from "@/lib/labels";
import type { ChapterView, SourceView } from "@/lib/workChapters";

export type SourceChip = SourceOption;

type Phase = "ready" | "loading" | "slow" | "failed";

const POLL_MS = 2_000;
const SLOW_MS = 8_000;
const FAIL_MS = 45_000;
const PAGE_SIZE = 100;

const RESUME_PREFIX: Record<ResumeKind, string> = {
  start: "Começar a ler",
  resume: "Continuar",
  next: "Continuar",
  reread: "Reler o último",
};

const TOOL =
  "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted hover:bg-elevated hover:text-text disabled:opacity-50";

const PLAIN_NAME = /^(?:chapter|cap[ií]tulo|cap\.?|ch\.?|#)?\s*([\d]+(?:[.,]\d+)?)\s*$/i;

// Suwayomi uploadDate is epoch millis as a string; fall back to Date.parse.
function uploadMs(s?: string | null): number {
  if (!s) return 0;
  const n = Number(s);
  const t = Number.isFinite(n) && n > 0 ? n : Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function chapterTitle(c: ChapterView): { main: string; sub: string | null } {
  const name = (c.name || "").trim();
  const num = c.chapterNumber > 0 ? formatChapterNumber(c.chapterNumber) : "";
  if (!name) return { main: num ? `Cap. ${num}` : "Capítulo", sub: null };
  if (PLAIN_NAME.test(name)) return { main: `Cap. ${num || PLAIN_NAME.exec(name)![1]}`, sub: null };
  if (num) {
    const stripped = name
      .replace(new RegExp(`^(?:chapter|cap[ií]tulo|cap\\.?|ch\\.?)\\s*${num.replace(".", "\\.")}\\s*[:\\-–—.]?\\s*`, "i"), "")
      .trim();
    if (stripped && stripped !== name) return { main: `Cap. ${num}`, sub: stripped };
    if (!name.includes(num)) return { main: `Cap. ${num}`, sub: name };
  }
  return { main: name, sub: null };
}

const warmed = new Set<number>();

export default function ChapterBrowser({
  slug,
  workId,
  sources,
  initialSourceId,
  initialScan,
  initialView,
}: {
  slug: string;
  workId: number;
  sources: SourceChip[];
  initialSourceId: number | null;
  initialScan: string | null;
  initialView: SourceView | null;
}) {
  const [activeId, setActiveId] = useState<number | null>(initialSourceId);
  const [views, setViews] = useState<Map<number, SourceView>>(() =>
    initialView ? new Map([[initialView.linkId, initialView]]) : new Map(),
  );
  const [scan, setScan] = useState<string | null>(initialScan);
  const [phase, setPhase] = useState<Phase>(
    initialView || initialSourceId == null ? "ready" : "loading",
  );
  const [filter, setFilter] = useState("");
  const [desc, setDesc] = useState(true);
  const [hideRead, setHideRead] = useState(false);
  const [page, setPage] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [readOverride, setReadOverride] = useState<Map<number, boolean>>(new Map());

  const wantedRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  const load = useCallback(
    (id: number) => {
      clearTimers();
      wantedRef.current = id;
      setPhase("loading");

      timersRef.current.push(
        setTimeout(() => {
          if (wantedRef.current === id) setPhase("slow");
        }, SLOW_MS),
        setTimeout(() => {
          if (wantedRef.current !== id) return;
          wantedRef.current = null;
          clearTimers();
          setPhase("failed");
        }, FAIL_MS),
      );

      const poll = async () => {
        if (wantedRef.current !== id) return;
        const res = await fetch(`/api/work-chapters?link=${id}`).catch(() => null);
        if (wantedRef.current !== id) return;
        const data = res?.ok
          ? ((await res.json().catch(() => null)) as
              | { status?: string; view?: SourceView }
              | null)
          : null;
        if (wantedRef.current !== id) return;
        if (data?.status === "ready" && data.view) {
          wantedRef.current = null;
          clearTimers();
          setViews((prev) => {
            const next = new Map(prev);
            next.set(id, data.view!);
            return next;
          });
          setPhase("ready");
          return;
        }
        timersRef.current.push(setTimeout(poll, POLL_MS));
      };
      void poll();
    },
    [clearTimers],
  );

  useEffect(() => {
    if (!initialView && initialSourceId != null) load(initialSourceId);
    return () => {
      wantedRef.current = null;
      clearTimers();
    };
    // Runs once: later switches go through selectSource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (menuFor == null) return;
    const close = () => setMenuFor(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  function warm(id: number) {
    if (warmed.has(id)) return;
    warmed.add(id);
    void fetch("/api/warm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ href: `/work/${slug}?src=${id}` }),
    }).catch(() => {});
  }

  function selectSource(id: number) {
    if (id === activeId) return;
    setActiveId(id);
    setScan(null);
    setPage(0);
    setReadOverride(new Map());
    window.history.replaceState(null, "", `/work/${slug}?src=${id}`);
    if (views.has(id)) {
      wantedRef.current = null;
      clearTimers();
      setPhase("ready");
      return;
    }
    load(id);
  }

  function selectScan(key: string) {
    setScan(key);
    setPage(0);
    if (activeId != null) {
      window.history.replaceState(
        null,
        "",
        `/work/${slug}?src=${activeId}&scan=${encodeURIComponent(key)}`,
      );
    }
  }

  // Zero-chapter links only add noise; the open source always stays.
  const options = useMemo(
    () => sources.filter((s) => s.chapterCount > 0 || s.id === activeId),
    [sources, activeId],
  );

  const view = activeId != null ? views.get(activeId) ?? null : null;
  const activeName =
    sources.find((s) => s.id === activeId)?.sourceName || view?.sourceName || "Fonte";

  const groups = view?.groups ?? [];
  const activeGroup = (scan != null ? groups.find((g) => g.key === scan) : undefined) ?? groups[0];
  const visible = activeGroup?.chapters ?? [];
  const chaptersAsc = useMemo(() => [...visible].reverse(), [visible]);

  const downloadStatus = useMemo(
    () => new Map<number, DownloadStatus>(view?.downloadStatus ?? []),
    [view],
  );
  const mirroredById = useMemo(() => new Map<number, number>(view?.mirrored ?? []), [view]);
  const readSet = useMemo(() => {
    const s = new Set((view?.progress ?? []).filter((p) => p.read).map((p) => p.chapterId));
    for (const [id, r] of readOverride) {
      if (r) s.add(id);
      else s.delete(id);
    }
    return s;
  }, [view, readOverride]);

  const resume = useMemo(() => {
    const progress = (view?.progress ?? []).map((p) => ({ ...p, updatedAt: new Date(p.updatedAt) }));
    for (const [id, r] of readOverride) {
      const i = progress.findIndex((p) => p.chapterId === id);
      if (i >= 0) progress[i] = { ...progress[i], read: r };
      else if (r) progress.push({ chapterId: id, read: true, lastPageRead: -1, updatedAt: new Date() });
    }
    return pickResumeChapter(chaptersAsc, progress.filter((p) => p.read || p.lastPageRead > 0));
  }, [chaptersAsc, view, readOverride]);
  const startId = resume ? mirroredById.get(resume.chapterId) ?? resume.chapterId : null;
  const startLabel = resume
    ? `${RESUME_PREFIX[resume.kind]} · Cap. ${formatChapterNumber(resume.chapterNumber)}`
    : "";
  const resumeIndex = resume ? chaptersAsc.findIndex((c) => c.id === resume.chapterId) : -1;
  const nextChapters =
    resumeIndex >= 0
      ? chaptersAsc
          .slice(resumeIndex, resumeIndex + 5)
          .map((c) => ({ chapterId: c.id, name: c.name, number: c.chapterNumber }))
      : [];
  const readCount = chaptersAsc.filter((c) => readSet.has(c.id)).length;

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let list = desc ? visible : chaptersAsc;
    if (hideRead) list = list.filter((c) => !readSet.has(c.id));
    if (needle) {
      list = list.filter((c) => {
        const t = chapterTitle(c);
        return (
          t.main.toLowerCase().includes(needle) ||
          (t.sub ?? "").toLowerCase().includes(needle) ||
          (c.name || "").toLowerCase().includes(needle) ||
          formatChapterNumber(c.chapterNumber) === needle
        );
      });
    }
    return list;
  }, [visible, chaptersAsc, desc, hideRead, filter, readSet]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  async function setRead(chapters: ChapterView[], read: boolean) {
    if (!view || !chapters.length) return;
    setMenuFor(null);
    setReadOverride((prev) => {
      const next = new Map(prev);
      for (const c of chapters) next.set(c.id, read);
      return next;
    });
    await fetch("/api/progress/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mangaId: view.sourceMangaId,
        workId,
        read,
        chapters: chapters.map((c) => ({ chapterId: c.id, chapterNumber: c.chapterNumber })),
      }),
    }).catch(() => {});
  }

  function markUpTo(c: ChapterView) {
    const idx = chaptersAsc.findIndex((x) => x.id === c.id);
    if (idx < 0) return;
    void setRead(chaptersAsc.slice(0, idx + 1).filter((x) => !readSet.has(x.id)), true);
  }

  const waiting = phase === "loading" || phase === "slow";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SourcePicker sources={options} activeId={activeId} onSelect={selectSource} onHover={warm} />
        {groups.length > 1 ? (
          <label className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted">
            Grupo
            <select
              value={activeGroup?.key ?? ""}
              onChange={(e) => selectScan(e.target.value)}
              className="max-w-[10rem] bg-transparent text-sm text-text outline-none"
            >
              {groups.map((g) => (
                <option key={g.key || "—"} value={g.key}>
                  {(g.key || "Sem grupo") + ` (${g.count})`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="relative ml-auto min-w-[8rem] flex-1 sm:max-w-[14rem] sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
            placeholder="Nº ou título"
            aria-label="Filtrar capítulos"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-7 text-sm text-text outline-none placeholder:text-muted focus:border-accent"
          />
          {filter ? (
            <button
              type="button"
              aria-label="Limpar filtro"
              onClick={() => setFilter("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setDesc((v) => !v);
            setPage(0);
          }}
          aria-label={desc ? "Mais novos primeiro" : "Mais antigos primeiro"}
          title={desc ? "Mais novos primeiro" : "Mais antigos primeiro"}
          className={TOOL}
        >
          {desc ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setHideRead((v) => !v);
            setPage(0);
          }}
          aria-pressed={hideRead}
          title={hideRead ? "Mostrar lidos" : "Ocultar lidos"}
          className={`${TOOL} ${hideRead ? "border-accent text-accent" : ""}`}
        >
          {hideRead ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setToolsOpen((v) => !v)}
          aria-expanded={toolsOpen}
          className={`${TOOL} ${toolsOpen ? "border-accent text-accent" : ""}`}
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Baixar</span>
        </button>
      </div>

      {waiting ? (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
            Carregando capítulos de {activeName}…
          </div>
          {phase === "slow" ? (
            <p className="text-xs text-muted">Esta fonte está demorando, pode levar até um minuto.</p>
          ) : null}
          <div className="space-y-1.5 pt-2">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-11 w-full animate-pulse rounded-lg bg-elevated/60" />
            ))}
          </div>
        </div>
      ) : phase === "failed" ? (
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted">{activeName} não respondeu.</p>
          <button
            type="button"
            onClick={() => activeId != null && load(activeId)}
            className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:bg-elevated"
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <>
          {startId ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/reader/${startId}`}
                className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-hover sm:flex-none sm:px-6"
              >
                <BookOpen className="h-4 w-4" />
                {startLabel}
              </Link>
              {chaptersAsc.length > 1 && resume?.kind !== "start" ? (
                <Link
                  href={`/reader/${mirroredById.get(chaptersAsc[0].id) ?? chaptersAsc[0].id}`}
                  className="flex items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm text-muted hover:bg-elevated hover:text-text"
                >
                  Primeiro
                </Link>
              ) : null}
              {chaptersAsc.length > 1 ? (
                <Link
                  href={`/reader/${
                    mirroredById.get(chaptersAsc[chaptersAsc.length - 1].id) ??
                    chaptersAsc[chaptersAsc.length - 1].id
                  }`}
                  className="flex items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm text-muted hover:bg-elevated hover:text-text"
                >
                  Último
                </Link>
              ) : null}
            </div>
          ) : null}

          {toolsOpen && view ? (
            <div className="space-y-3 rounded-xl border border-border bg-surface/60 p-3">
              {nextChapters.length > 0 ? (
                <DownloadButton
                  key={`next-${view.linkId}`}
                  label="Baixar os 5 próximos"
                  chapters={nextChapters}
                  mangaId={view.sourceMangaId}
                  workId={workId}
                />
              ) : null}
              {visible.length > 0 ? (
                <BulkDownloadBar
                  key={`bulk-${view.linkId}-${activeGroup?.key ?? ""}`}
                  chapters={chaptersAsc.map((c) => ({
                    chapterId: c.id,
                    name: c.name,
                    number: c.chapterNumber,
                  }))}
                  mangaId={view.sourceMangaId}
                  workId={workId}
                />
              ) : null}
              {view.autoReadCount > 0 ? (
                <UndoAutoReadButton
                  workId={workId}
                  mangaId={view.sourceMangaId}
                  count={view.autoReadCount}
                />
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {filtered.length === visible.length
                ? `${visible.length} capítulos`
                : `${filtered.length} de ${visible.length} capítulos`}
              {readCount ? ` · ${readCount} lidos` : ""}
            </span>
            {pageCount > 1 ? (
              <span>
                Página {safePage + 1} de {pageCount}
              </span>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              {view
                ? options.length > 1
                  ? "Esta fonte não tem capítulos. Tente outra fonte."
                  : "Esta fonte ainda não tem capítulos."
                : "Selecione uma fonte para ver os capítulos."}
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-sm text-muted">Nenhum capítulo bate com o filtro.</p>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-border bg-surface/40">
              {pageItems.map((c) => {
                const read = readSet.has(c.id);
                const own = downloadStatus.get(c.id) ?? null;
                const mirroredId = own === "DONE" ? null : mirroredById.get(c.id) ?? null;
                const status = own ?? (mirroredId ? "DONE" : null);
                const isResume = resume?.chapterId === c.id;
                const t = chapterTitle(c);
                const ms = uploadMs(c.uploadDate);
                return (
                  <li
                    key={c.id}
                    className={`group relative flex items-center gap-1 border-b border-border/70 last:border-b-0 ${
                      isResume ? "bg-accent/[0.07]" : "hover:bg-elevated/60"
                    }`}
                  >
                    {isResume ? <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" /> : null}
                    <button
                      type="button"
                      onClick={() => setRead([c], !read)}
                      aria-label={read ? "Marcar como não lido" : "Marcar como lido"}
                      title={read ? "Marcar como não lido" : "Marcar como lido"}
                      className="flex h-11 w-9 shrink-0 items-center justify-center text-muted hover:text-accent"
                    >
                      {read ? (
                        <CheckCircle2 className="h-4 w-4 text-accent" />
                      ) : (
                        <Circle className="h-4 w-4 opacity-60" />
                      )}
                    </button>
                    <Link
                      href={`/reader/${mirroredId ?? c.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-1"
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${read ? "text-muted" : "text-text"}`}>
                          <span className="font-medium">{t.main}</span>
                          {t.sub ? <span className="text-muted"> · {t.sub}</span> : null}
                        </p>
                        <p className="flex items-center gap-1.5 truncate text-[11px] text-muted">
                          {activeGroup?.key ? <span className="truncate">{activeGroup.key}</span> : null}
                          {activeGroup?.key && ms ? <span>·</span> : null}
                          {ms ? <span title={fmtDate(ms)}>{timeAgo(ms)}</span> : null}
                          {mirroredId ? (
                            <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px]">
                              baixado em outra fonte
                            </span>
                          ) : null}
                          {status === "DONE" && !mirroredId ? (
                            <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-green-400">
                              <Check className="h-3 w-3" /> baixado
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </Link>
                    {view && status !== "DONE" ? (
                      <div className="hidden pr-1 sm:block">
                        <DownloadButton
                          chapters={[{ chapterId: c.id, name: c.name, number: c.chapterNumber }]}
                          mangaId={view.sourceMangaId}
                          workId={workId}
                          initialStatus={status}
                        />
                      </div>
                    ) : null}
                    <div className="relative pr-1" onMouseDown={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setMenuFor((v) => (v === c.id ? null : c.id))}
                        aria-label="Mais ações"
                        className="flex h-9 w-8 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-text"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menuFor === c.id ? (
                        <div className="absolute right-1 top-full z-30 mt-0.5 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm shadow-2xl shadow-black/60">
                          <button
                            type="button"
                            onClick={() => setRead([c], !read)}
                            className="flex w-full px-3 py-2 text-left text-text hover:bg-elevated"
                          >
                            {read ? "Marcar como não lido" : "Marcar como lido"}
                          </button>
                          <button
                            type="button"
                            onClick={() => markUpTo(c)}
                            className="flex w-full px-3 py-2 text-left text-text hover:bg-elevated"
                          >
                            Marcar lidos até aqui
                          </button>
                          {view && status !== "DONE" ? (
                            <div className="px-3 py-2 sm:hidden">
                              <DownloadButton
                                chapters={[{ chapterId: c.id, name: c.name, number: c.chapterNumber }]}
                                mangaId={view.sourceMangaId}
                                workId={workId}
                                initialStatus={status}
                                label="Baixar capítulo"
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {pageCount > 1 ? (
            <nav className="flex flex-wrap items-center justify-center gap-1 pt-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className={TOOL}
              >
                Anterior
              </button>
              {Array.from({ length: pageCount }, (_, i) => i)
                .filter((i) => i === 0 || i === pageCount - 1 || Math.abs(i - safePage) <= 2)
                .reduce<(number | "gap")[]>((acc, i) => {
                  const prev = acc[acc.length - 1];
                  if (typeof prev === "number" && i - prev > 1) acc.push("gap");
                  acc.push(i);
                  return acc;
                }, [])
                .map((i, k) =>
                  i === "gap" ? (
                    <span key={`gap-${k}`} className="px-1 text-xs text-muted">
                      …
                    </span>
                  ) : (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPage(i)}
                      className={`h-9 min-w-9 rounded-lg px-2 text-xs ${
                        i === safePage
                          ? "bg-accent font-medium text-on-accent"
                          : "border border-border bg-surface text-muted hover:bg-elevated hover:text-text"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ),
                )}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className={TOOL}
              >
                Próxima
              </button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
