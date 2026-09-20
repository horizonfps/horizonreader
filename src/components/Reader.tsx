"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Settings2,
  X,
  Maximize2,
  List,
  ArrowLeft,
} from "lucide-react";
import SaveOfflineButton from "@/components/SaveOfflineButton";
import { flushProgress, queueProgress, type PendingProgress } from "@/lib/offlineProgress";
import { formatChapterNumber } from "@/lib/continueReading";

type Mode = "vertical" | "paged";
type Dir = "ltr" | "rtl";
type Width = "fit" | "720" | "960" | "1200" | "full";
type Bg = "black" | "gray" | "white";

export type ReaderChapter = { id: number; number: number; name: string };

type Props = {
  chapterId: number;
  mangaId: number;
  workId?: number | null;
  workSlug?: string | null;
  workTitle?: string | null;
  chapterNumber?: number;
  pageUrls: string[];
  initialPage: number;
  title: string;
  prevChapterId: number | null;
  nextChapterId: number | null;
  prevSourceName?: string | null;
  nextSourceName?: string | null;
  nextChapterNumber?: number | null;
  prevChapterNumber?: number | null;
  chapters?: ReaderChapter[];
  downloaded?: boolean;
};

type Settings = { mode: Mode; dir: Dir; width: Width; gap: number; bg: Bg };

const SETTINGS_KEY = "reader:settings";
const DEFAULT_SETTINGS: Settings = { mode: "vertical", dir: "ltr", width: "960", gap: 0, bg: "black" };
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 500;
// Pages pulled ahead of the viewport so scrolling doesn't wait on the network.
const PRELOAD_AHEAD = 6;
// Past this fraction of the chapter, the next chapter gets prepared in the
// background so the next-chapter link opens instantly.
const NEXT_CHAPTER_AT = 0.6;
const NEXT_CHAPTER_PAGES = 4;
// A prefetched dynamic route payload is only kept ~30s client-side
// (next.config.mjs's staleTimes.dynamic), so the prefetch is repeated.
const REPREFETCH_EVERY_MS = 25_000;
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.25;
const ZOOM_DBLCLICK = 2.5;
const UI_HIDE_MS = 3_000;

const WIDTH_PX: Record<Width, string> = {
  fit: "min(100%, 100vh * 0.72)",
  "720": "720px",
  "960": "960px",
  "1200": "1200px",
  full: "100%",
};
const WIDTH_LABEL: Record<Width, string> = {
  fit: "Ajustar à altura",
  "720": "Estreita",
  "960": "Média",
  "1200": "Larga",
  full: "Tela inteira",
};
const BG_CLASS: Record<Bg, string> = { black: "bg-black", gray: "bg-neutral-800", white: "bg-neutral-100" };

function clampScale(s: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
}

function touchDistance(touches: React.TouchList): number {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}

function retryUrl(url: string, attempt: number): string {
  if (attempt === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_r=${attempt}`;
}

function chapterLabel(c: ReaderChapter): string {
  const n = c.number > 0 ? `Cap. ${formatChapterNumber(c.number)}` : "";
  const name = (c.name || "").trim();
  if (!n) return name || "Capítulo";
  if (!name || /^(chapter|cap[ií]tulo|cap\.?|ch\.?)\s*[\d.]+$/i.test(name)) return n;
  return `${n} · ${name}`;
}

// A dropped page used to leave a black gap for the rest of the session: the
// <img> had no error path. Retries with backoff, then offers a manual reload.
function PageImage({
  url,
  eager,
  onFirstLoad,
  className,
  wrapperClassName,
  loadingClassName,
}: {
  url: string;
  eager: boolean;
  onFirstLoad?: () => void;
  className: string;
  wrapperClassName?: string;
  loadingClassName?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const loadedRef = useRef(false);

  const markLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoaded(true);
    onFirstLoad?.();
  }, [onFirstLoad]);

  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) markLoaded();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attempt, markLoaded]);

  const onError = () => {
    if (attempt >= MAX_RETRIES) {
      setFailed(true);
      return;
    }
    const delay = RETRY_BASE_MS * 2 ** attempt;
    timer.current = setTimeout(() => setAttempt((a) => a + 1), delay);
  };

  const reload = () => {
    setFailed(false);
    setAttempt((a) => a + 1);
  };

  return (
    <div className={`relative ${wrapperClassName ?? ""} ${!loaded ? loadingClassName ?? "" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        key={attempt}
        src={retryUrl(url, attempt)}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={markLoaded}
        onError={onError}
        className={className}
      />
      {!loaded && !failed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        </div>
      ) : null}
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-sm text-white/80">
          <span>Não foi possível carregar esta página.</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              reload();
            }}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs backdrop-blur"
          >
            Tentar de novo
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Reader({
  chapterId,
  mangaId,
  workId,
  workSlug,
  workTitle,
  chapterNumber,
  pageUrls,
  initialPage,
  title,
  prevChapterId,
  nextChapterId,
  prevSourceName,
  nextSourceName,
  nextChapterNumber,
  prevChapterNumber,
  chapters = [],
  downloaded,
}: Props) {
  const router = useRouter();
  const total = pageUrls.length;
  const backHref = workSlug ? `/work/${workSlug}` : "/";

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const { mode, dir, width, gap, bg } = settings;
  const [page, setPage] = useState(initialPage);
  const [showUI, setShowUI] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(initialPage);
  const pageRef = useRef(page);
  pageRef.current = page;
  // Saving is disarmed until the resume scroll settles, so the observer can't
  // overwrite stored progress with a low index while jumping to initialPage.
  const armedRef = useRef(initialPage <= 0);
  const warmedNextRef = useRef(false);
  const lastNextPrefetchRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Settings>;
        setSettings((prev) => ({
          mode: s.mode === "vertical" || s.mode === "paged" ? s.mode : prev.mode,
          dir: s.dir === "ltr" || s.dir === "rtl" ? s.dir : prev.dir,
          width: s.width && s.width in WIDTH_PX ? s.width : prev.width,
          gap: typeof s.gap === "number" ? s.gap : prev.gap,
          bg: s.bg === "black" || s.bg === "gray" || s.bg === "white" ? s.bg : prev.bg,
        }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const saveProgress = useCallback(
    (p: number, opts?: { beacon?: boolean }) => {
      const read = p >= total - 1;
      const pending = (): PendingProgress => ({
        chapterId,
        mangaId,
        workId: workId ?? null,
        chapterNumber: chapterNumber ?? null,
        lastPageRead: p,
        read,
        at: Date.now(),
      });
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        void queueProgress(pending());
        return;
      }
      const payload = JSON.stringify({ mangaId, chapterId, workId, chapterNumber, lastPageRead: p, read });
      if (opts?.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/progress", new Blob([payload], { type: "application/json" }));
        return;
      }
      fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        void queueProgress(pending());
      });
    },
    [mangaId, chapterId, workId, chapterNumber, total],
  );

  // Anything read while the network was down still owes the server a save.
  useEffect(() => {
    void flushProgress();
  }, []);

  // debounced progress save while reading (only once resume has settled)
  useEffect(() => {
    const t = setTimeout(() => {
      if (armedRef.current && page !== savedRef.current) {
        savedRef.current = page;
        saveProgress(page);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [page, saveProgress]);

  // best-effort save on internal navigation (React unmount) and hard unload
  useEffect(() => {
    const flush = () => {
      if (armedRef.current) saveProgress(pageRef.current, { beacon: true });
    };
    const onHide = () => flush();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [saveProgress]);

  // vertical: track current page (viewport center) + detect end-of-chapter
  useEffect(() => {
    if (mode !== "vertical" || !containerRef.current) return;
    const root = containerRef.current;

    const pageObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) setPage(idx);
          }
        }
      },
      { root, rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    wrapRefs.current.forEach((el) => el && pageObs.observe(el));

    // Reaching the footer marks the chapter as read even if the last (short)
    // image never crosses the viewport center.
    const endObs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setPage(total - 1);
      },
      { root, threshold: 0.1 },
    );
    if (endRef.current) endObs.observe(endRef.current);

    return () => {
      pageObs.disconnect();
      endObs.disconnect();
    };
  }, [mode, total]);

  // vertical: jump to resume position, re-scrolling once the target image
  // has loaded (lazy images above would otherwise collapse the layout).
  const didArmTimer = useRef(false);
  useEffect(() => {
    if (mode !== "vertical") return;
    if (initialPage > 0) wrapRefs.current[initialPage]?.scrollIntoView();
    if (!didArmTimer.current) {
      didArmTimer.current = true;
      const t = setTimeout(() => {
        armedRef.current = true;
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [mode, initialPage]);

  const settleResume = useCallback(() => {
    if (armedRef.current) return;
    wrapRefs.current[initialPage]?.scrollIntoView();
    armedRef.current = true;
  }, [initialPage]);

  // Warm the pages just ahead of the viewport so scrolling lands on a decoded
  // image instead of a network round trip.
  useEffect(() => {
    for (let i = page + 1; i <= page + PRELOAD_AHEAD && i < total; i++) {
      const img = new window.Image();
      img.decoding = "async";
      img.src = pageUrls[i];
    }
  }, [page, total, pageUrls]);

  // Past NEXT_CHAPTER_AT, warm the next chapter's route plus its first pages,
  // so the chapter switch has no black-screen wait.
  useEffect(() => {
    if (!nextChapterId || total === 0) return;
    if ((page + 1) / total < NEXT_CHAPTER_AT) return;
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;

    const now = Date.now();
    if (now - lastNextPrefetchRef.current >= REPREFETCH_EVERY_MS) {
      lastNextPrefetchRef.current = now;
      router.prefetch(`/reader/${nextChapterId}`);
    }

    if (warmedNextRef.current) return;
    warmedNextRef.current = true;
    fetch(`/api/chapter-pages?id=${nextChapterId}&limit=${NEXT_CHAPTER_PAGES}`)
      .then((r) => r.json())
      .then((d: { urls?: string[] }) => {
        for (const url of d.urls ?? []) {
          const img = new window.Image();
          img.decoding = "async";
          img.src = url;
        }
      })
      .catch(() => {});
  }, [page, total, nextChapterId, router]);

  const goNextPage = useCallback(() => {
    setPage((p) => {
      if (p >= total - 1) {
        if (nextChapterId) router.push(`/reader/${nextChapterId}`);
        return p;
      }
      return p + 1;
    });
  }, [total, nextChapterId, router]);

  const goPrevPage = useCallback(() => {
    setPage((p) => {
      if (p <= 0) {
        if (prevChapterId) router.push(`/reader/${prevChapterId}`);
        return p;
      }
      return p - 1;
    });
  }, [prevChapterId, router]);

  // keyboard: pages in paged mode, chapters in vertical mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (zoomIndex !== null) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") {
        if (mode === "paged") dir === "rtl" ? goPrevPage() : goNextPage();
        else if (nextChapterId) router.push(`/reader/${nextChapterId}`);
      } else if (e.key === "ArrowLeft") {
        if (mode === "paged") dir === "rtl" ? goNextPage() : goPrevPage();
        else if (prevChapterId) router.push(`/reader/${prevChapterId}`);
      } else if (e.key === "m" || e.key === "M") {
        update({ mode: mode === "vertical" ? "paged" : "vertical" });
      } else if (e.key === "h" || e.key === "H") {
        setShowUI((v) => !v);
      } else if (e.key === "Escape") {
        setSettingsOpen(false);
        setShowUI(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, dir, zoomIndex, goNextPage, goPrevPage, nextChapterId, prevChapterId, router, update]);

  // The bars fade out on their own after a moment of no interaction.
  useEffect(() => {
    if (!showUI || settingsOpen) return;
    hideTimerRef.current = setTimeout(() => setShowUI(false), UI_HIDE_MS);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showUI, settingsOpen, page]);

  const openZoom = useCallback((i: number) => {
    setZoomIndex(i);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setShowUI(false);
  }, []);

  const closeZoom = useCallback(() => setZoomIndex(null), []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const applyScale = useCallback((next: number) => {
    const s = clampScale(next);
    setScale(s);
    if (s === ZOOM_MIN) setOffset({ x: 0, y: 0 });
  }, []);

  // React's onWheel is passive, so it can't stop the chapter scrolling behind.
  useEffect(() => {
    if (zoomIndex === null) return;
    const el = zoomLayerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyScale(scaleRef.current * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomIndex, applyScale]);

  useEffect(() => {
    if (zoomIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeZoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIndex, closeZoom]);

  const onZoomPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || scaleRef.current <= ZOOM_MIN) return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onZoomPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
  };

  const onZoomPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onZoomTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2) {
      pinchRef.current = { dist: touchDistance(e.touches), scale: scaleRef.current };
      dragRef.current = null;
      return;
    }
    if (e.touches.length === 1 && scaleRef.current > ZOOM_MIN) {
      dragRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        ox: offsetRef.current.x,
        oy: offsetRef.current.y,
      };
    }
  };

  const onZoomTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (e.touches.length >= 2 && pinch && pinch.dist > 0) {
      applyScale(pinch.scale * (touchDistance(e.touches) / pinch.dist));
      return;
    }
    const d = dragRef.current;
    if (e.touches.length === 1 && d) {
      setOffset({
        x: d.ox + e.touches[0].clientX - d.x,
        y: d.oy + e.touches[0].clientY - d.y,
      });
    }
  };

  const onZoomTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) dragRef.current = null;
  };

  function onTapZones(e: React.MouseEvent<HTMLDivElement>) {
    const x = e.clientX;
    const w = window.innerWidth;
    if (x < w * 0.33) {
      dir === "rtl" ? goNextPage() : goPrevPage();
    } else if (x > w * 0.67) {
      dir === "rtl" ? goPrevPage() : goNextPage();
    } else {
      setShowUI((v) => !v);
    }
  }

  const chapterTitle = useMemo(() => {
    const n = chapterNumber && chapterNumber > 0 ? `Cap. ${formatChapterNumber(chapterNumber)}` : "";
    const t = (title || "").trim();
    if (!n) return t || "Capítulo";
    if (!t || /^(chapter|cap[ií]tulo|cap\.?|ch\.?)\s*[\d.]+$/i.test(t)) return n;
    return `${n} · ${t}`;
  }, [chapterNumber, title]);

  const progressPct = total > 0 ? ((page + 1) / total) * 100 : 0;
  const light = bg === "white";

  if (total === 0) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-black text-muted">
        <p>Esta fonte não devolveu páginas.</p>
        <Link href={backHref} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white">
          Voltar à obra
        </Link>
      </div>
    );
  }

  const nextLabel = nextChapterNumber ? `Cap. ${formatChapterNumber(nextChapterNumber)}` : "Próximo";
  const prevLabel = prevChapterNumber ? `Cap. ${formatChapterNumber(prevChapterNumber)}` : "Anterior";

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden ${BG_CLASS[bg]}`}>
      {/* ---- content ---- */}
      {mode === "vertical" ? (
        <div
          ref={containerRef}
          onClick={() => setShowUI((v) => !v)}
          className="no-scrollbar h-full w-full overflow-y-auto"
        >
          <div className="mx-auto w-full" style={{ maxWidth: WIDTH_PX[width] }}>
            {pageUrls.map((url, i) => (
              <div
                key={i}
                data-idx={i}
                ref={(el) => {
                  wrapRefs.current[i] = el;
                }}
                onDoubleClick={() => openZoom(i)}
                style={gap ? { marginBottom: gap } : undefined}
              >
                <PageImage
                  url={url}
                  eager={i <= Math.max(initialPage, 0) + 2}
                  onFirstLoad={i === initialPage ? settleResume : undefined}
                  loadingClassName="min-h-[60vh]"
                  className="block h-auto w-full select-none"
                />
              </div>
            ))}
          </div>
          <div
            ref={endRef}
            className={`mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-12 ${light ? "text-neutral-800" : "text-white"}`}
          >
            <p className="text-xs uppercase tracking-widest opacity-60">Fim de {chapterTitle}</p>
            {nextChapterId ? (
              <Link
                href={`/reader/${nextChapterId}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
              >
                {nextLabel}
                {nextSourceName ? <span className="opacity-70">· em {nextSourceName}</span> : null}
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <p className="text-sm opacity-70">Não há capítulo seguinte nesta fonte.</p>
            )}
            <Link
              href={backHref}
              className={`flex items-center gap-1.5 text-xs ${light ? "text-neutral-600" : "text-white/70"} hover:underline`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar à obra
            </Link>
          </div>
        </div>
      ) : (
        <div className="h-full w-full" onClick={onTapZones} onDoubleClick={() => openZoom(page)}>
          <div className="flex h-full w-full items-center justify-center">
            <PageImage
              key={page}
              url={pageUrls[page]}
              eager
              wrapperClassName="flex h-full w-full items-center justify-center"
              className="max-h-full max-w-full select-none object-contain"
            />
          </div>
        </div>
      )}

      {/* ---- always-on progress line ---- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10">
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progressPct}%` }} />
      </div>

      {/* ---- floating controls (only while the bars are hidden) ---- */}
      {!showUI && !settingsOpen && (
        <>
          <Link
            href={backHref}
            aria-label="Voltar à obra"
            className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <button
            onClick={() => setShowUI(true)}
            aria-label="Mostrar controles"
            className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
          >
            <List className="h-4 w-4" />
          </button>
        </>
      )}

      {/* ---- overlay UI ---- */}
      {showUI && (
        <>
          <div
            onMouseEnter={() => hideTimerRef.current && clearTimeout(hideTimerRef.current)}
            className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-black/75 px-3 py-2.5 text-white backdrop-blur"
          >
            <Link href={backHref} aria-label="Voltar à obra" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0 flex-1">
              {workTitle ? (
                <Link href={backHref} className="block truncate text-sm font-medium hover:underline">
                  {workTitle}
                </Link>
              ) : null}
              <p className="truncate text-xs text-white/70">
                {chapterTitle}
                {downloaded ? <span className="ml-1.5 rounded bg-white/15 px-1 py-px text-[10px]">baixado</span> : null}
              </p>
            </div>
            <SaveOfflineButton
              chapterId={chapterId}
              chapterName={title}
              workTitle={workTitle}
              workSlug={workSlug}
              mangaId={mangaId}
              workId={workId}
              chapterNumber={chapterNumber}
              urls={pageUrls}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                openZoom(page);
              }}
              aria-label="Ampliar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Ajustes"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>

          <div
            onMouseEnter={() => hideTimerRef.current && clearTimeout(hideTimerRef.current)}
            className="absolute inset-x-0 bottom-0 z-20 bg-black/75 px-3 pb-3 pt-2 text-white backdrop-blur"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2">
              {prevChapterId ? (
                <Link
                  href={`/reader/${prevChapterId}`}
                  title={prevSourceName ? `${prevLabel} · ${prevSourceName}` : prevLabel}
                  className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-xs hover:bg-white/20"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">{prevLabel}</span>
                </Link>
              ) : (
                <span className="h-9 w-9 shrink-0" />
              )}

              {chapters.length > 1 ? (
                <select
                  value={chapterId}
                  onChange={(e) => router.push(`/reader/${e.target.value}`)}
                  aria-label="Capítulo"
                  className="h-9 min-w-0 flex-1 rounded-lg bg-white/10 px-2 text-xs text-white outline-none"
                >
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id} className="bg-neutral-900 text-white">
                      {chapterLabel(c)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="min-w-0 flex-1 truncate text-center text-xs">{chapterTitle}</span>
              )}

              {mode === "paged" ? (
                <input
                  type="range"
                  min={0}
                  max={total - 1}
                  value={page}
                  onChange={(e) => setPage(Number(e.target.value))}
                  className="hidden w-32 accent-[rgb(var(--accent))] sm:block"
                  dir={dir}
                  aria-label="Página"
                />
              ) : null}
              <span className="w-14 shrink-0 text-center text-xs tabular-nums">
                {page + 1}/{total}
              </span>

              {nextChapterId ? (
                <Link
                  href={`/reader/${nextChapterId}`}
                  title={nextSourceName ? `${nextLabel} · ${nextSourceName}` : nextLabel}
                  className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-xs hover:bg-white/20"
                >
                  <span className="hidden sm:inline">{nextLabel}</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : (
                <span className="h-9 w-9 shrink-0" />
              )}
            </div>
          </div>
        </>
      )}

      {/* ---- settings panel ---- */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-40 flex items-end bg-black/50 sm:items-stretch sm:justify-end"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full space-y-5 overflow-y-auto rounded-t-2xl bg-surface p-5 text-text sm:w-80 sm:rounded-none sm:border-l sm:border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Leitura</p>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="Fechar"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <Field label="Modo">
              <Segmented
                value={mode}
                onChange={(v) => update({ mode: v as Mode })}
                options={[
                  { value: "vertical", label: "Vertical" },
                  { value: "paged", label: "Paginado" },
                ]}
              />
            </Field>

            {mode === "paged" ? (
              <Field label="Direção">
                <Segmented
                  value={dir}
                  onChange={(v) => update({ dir: v as Dir })}
                  options={[
                    { value: "ltr", label: "Esquerda → direita" },
                    { value: "rtl", label: "Direita → esquerda" },
                  ]}
                />
              </Field>
            ) : (
              <>
                <Field label="Largura">
                  <Segmented
                    value={width}
                    onChange={(v) => update({ width: v as Width })}
                    options={(Object.keys(WIDTH_PX) as Width[]).map((w) => ({ value: w, label: WIDTH_LABEL[w] }))}
                    wrap
                  />
                </Field>
                <Field label="Espaço entre páginas">
                  <Segmented
                    value={String(gap)}
                    onChange={(v) => update({ gap: Number(v) })}
                    options={[
                      { value: "0", label: "Nenhum" },
                      { value: "8", label: "Pequeno" },
                      { value: "20", label: "Grande" },
                    ]}
                  />
                </Field>
              </>
            )}

            <Field label="Fundo">
              <Segmented
                value={bg}
                onChange={(v) => update({ bg: v as Bg })}
                options={[
                  { value: "black", label: "Preto" },
                  { value: "gray", label: "Cinza" },
                  { value: "white", label: "Branco" },
                ]}
              />
            </Field>

            <div className="space-y-1 border-t border-border pt-4 text-xs text-muted">
              <p className="mb-1.5 font-medium text-text">Atalhos</p>
              <p><kbd className="rounded border border-border px-1">←</kbd> <kbd className="rounded border border-border px-1">→</kbd> {mode === "paged" ? "página" : "capítulo"} anterior / seguinte</p>
              <p><kbd className="rounded border border-border px-1">M</kbd> alterna vertical / paginado</p>
              <p><kbd className="rounded border border-border px-1">H</kbd> mostra ou esconde os controles</p>
              <p>Duplo clique amplia a página</p>
            </div>
          </div>
        </div>
      )}

      {/* ---- fullscreen zoom layer ---- */}
      {zoomIndex !== null && (
        <div
          ref={zoomLayerRef}
          onClick={closeZoom}
          onTouchStart={onZoomTouchStart}
          onTouchMove={onZoomTouchMove}
          onTouchEnd={onZoomTouchEnd}
          onTouchCancel={onZoomTouchEnd}
          style={{ touchAction: "none" }}
          className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/95"
        >
          <div className="absolute right-3 top-3 z-10 flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                applyScale(scale / ZOOM_STEP);
              }}
              aria-label="Reduzir zoom"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg leading-none text-white backdrop-blur"
            >
              −
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                resetZoom();
              }}
              aria-label="Voltar ao tamanho original"
              className="flex h-9 min-w-[3.5rem] items-center justify-center rounded-full bg-white/15 px-2 text-xs tabular-nums text-white backdrop-blur"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                applyScale(scale * ZOOM_STEP);
              }}
              aria-label="Aumentar zoom"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg leading-none text-white backdrop-blur"
            >
              +
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeZoom();
              }}
              aria-label="Fechar"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm leading-none text-white backdrop-blur"
            >
              ✕
            </button>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              applyScale(scale > ZOOM_MIN ? ZOOM_MIN : ZOOM_DBLCLICK);
            }}
            onPointerDown={onZoomPointerDown}
            onPointerMove={onZoomPointerMove}
            onPointerUp={onZoomPointerUp}
            onPointerCancel={onZoomPointerUp}
            style={{ touchAction: "none", cursor: scale > ZOOM_MIN ? "grab" : "default" }}
            className="flex max-h-full max-w-full items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pageUrls[zoomIndex]}
              alt=""
              draggable={false}
              className="max-h-[100dvh] max-w-full select-none object-contain"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: "center",
                transition: "none",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {children}
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
  wrap,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  wrap?: boolean;
}) {
  return (
    <div className={`flex gap-1.5 ${wrap ? "flex-wrap" : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-2 text-xs ${wrap ? "" : "flex-1"} ${
            value === o.value ? "bg-accent font-medium text-on-accent" : "bg-elevated text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
