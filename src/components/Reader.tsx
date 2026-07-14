"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Mode = "vertical" | "paged";
type Dir = "ltr" | "rtl";

type Props = {
  chapterId: number;
  mangaId: number;
  workId?: number | null;
  workSlug?: string | null;
  chapterNumber?: number;
  pageUrls: string[];
  initialPage: number;
  title: string;
  prevChapterId: number | null;
  nextChapterId: number | null;
};

const SETTINGS_KEY = "reader:settings";

export default function Reader({
  chapterId,
  mangaId,
  workId,
  workSlug,
  chapterNumber,
  pageUrls,
  initialPage,
  title,
  prevChapterId,
  nextChapterId,
}: Props) {
  const router = useRouter();
  const total = pageUrls.length;
  const backHref = workSlug ? `/work/${workSlug}` : "/";

  const [mode, setMode] = useState<Mode>("vertical");
  const [dir, setDir] = useState<Dir>("ltr");
  const [page, setPage] = useState(initialPage);
  const [showUI, setShowUI] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(initialPage);
  const pageRef = useRef(page);
  pageRef.current = page;
  // Saving is disarmed until the resume scroll settles, so the observer can't
  // overwrite stored progress with a low index while jumping to initialPage.
  const armedRef = useRef(initialPage <= 0);

  // load persisted settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { mode?: Mode; dir?: Dir };
        if (s.mode === "vertical" || s.mode === "paged") setMode(s.mode);
        if (s.dir === "ltr" || s.dir === "rtl") setDir(s.dir);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persistSettings = useCallback((m: Mode, d: Dir) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: m, dir: d }));
    } catch {
      /* ignore */
    }
  }, []);

  const saveProgress = useCallback(
    (p: number, opts?: { beacon?: boolean }) => {
      const read = p >= total - 1;
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
      }).catch(() => {});
    },
    [mangaId, chapterId, workId, chapterNumber, total],
  );

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

  // paged: keyboard support
  useEffect(() => {
    if (mode !== "paged") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") dir === "rtl" ? goPrevPage() : goNextPage();
      if (e.key === "ArrowLeft") dir === "rtl" ? goNextPage() : goPrevPage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, dir, goNextPage, goPrevPage]);

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

  if (total === 0) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-black text-muted">
        Sem páginas.
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
      {/* ---- content ---- */}
      {mode === "vertical" ? (
        <div ref={containerRef} className="no-scrollbar h-full w-full overflow-y-auto">
          {pageUrls.map((url, i) => (
            <div
              key={i}
              data-idx={i}
              ref={(el) => {
                wrapRefs.current[i] = el;
              }}
              style={{ minHeight: "60vh" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                loading="lazy"
                onLoad={i === initialPage ? settleResume : undefined}
                className="block w-full select-none"
              />
            </div>
          ))}
          <div ref={endRef} className="flex flex-col items-center gap-3 py-10">
            {nextChapterId ? (
              <Link href={`/reader/${nextChapterId}`} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-on-accent">
                Próximo capítulo →
              </Link>
            ) : (
              <p className="text-sm text-muted">Fim.</p>
            )}
            <Link href={backHref} className="text-xs text-muted">
              voltar ao mangá
            </Link>
          </div>
        </div>
      ) : (
        <div className="h-full w-full" onClick={onTapZones}>
          <div className="flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pageUrls[page]} alt="" className="max-h-full max-w-full select-none object-contain" />
          </div>
          {page + 1 < total && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pageUrls[page + 1]} alt="" className="hidden" />
          )}
        </div>
      )}

      {/* ---- floating back-to-manga (always reachable) ---- */}
      <Link
        href={backHref}
        aria-label="Voltar ao mangá"
        className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-lg leading-none text-white backdrop-blur"
      >
        ‹
      </Link>

      {/* ---- floating settings toggle ---- */}
      <button
        onClick={() => {
          setShowUI(true);
          setSettingsOpen((v) => !v);
        }}
        className="absolute right-3 top-3 z-30 rounded-full bg-black/60 px-3 py-2 text-xs text-white backdrop-blur"
      >
        ⚙
      </button>

      {/* ---- overlay UI ---- */}
      {showUI && (
        <>
          <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-black/70 px-4 py-3 text-white backdrop-blur">
            <Link href={backHref} className="text-lg leading-none">
              ‹
            </Link>
            <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
            <button onClick={() => setSettingsOpen((v) => !v)} className="text-xs">
              Ajustes
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-black/70 px-4 py-3 text-white backdrop-blur">
            {prevChapterId ? (
              <Link href={`/reader/${prevChapterId}`} className="text-xs">
                ‹ cap
              </Link>
            ) : (
              <span className="w-8" />
            )}
            {mode === "paged" ? (
              <input
                type="range"
                min={0}
                max={total - 1}
                value={page}
                onChange={(e) => setPage(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
                dir={dir}
              />
            ) : (
              <span className="flex-1" />
            )}
            <span className="w-12 text-right text-xs tabular-nums">
              {page + 1}/{total}
            </span>
            {nextChapterId ? (
              <Link href={`/reader/${nextChapterId}`} className="text-xs">
                cap ›
              </Link>
            ) : (
              <span className="w-8" />
            )}
          </div>
        </>
      )}

      {/* ---- settings panel ---- */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-40 flex items-end bg-black/50"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full space-y-4 rounded-t-2xl bg-surface p-5 text-text"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted">Modo de leitura</p>
              <div className="flex gap-2">
                {(["vertical", "paged"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      persistSettings(m, dir);
                    }}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm ${mode === m ? "bg-accent text-on-accent" : "bg-elevated text-muted"}`}
                  >
                    {m === "vertical" ? "Vertical (webtoon)" : "Paginado"}
                  </button>
                ))}
              </div>
            </div>

            {mode === "paged" && (
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted">Direção</p>
                <div className="flex gap-2">
                  {(["ltr", "rtl"] as Dir[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setDir(d);
                        persistSettings(mode, d);
                      }}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm ${dir === d ? "bg-accent text-on-accent" : "bg-elevated text-muted"}`}
                    >
                      {d === "ltr" ? "Esquerda → direita" : "Direita → esquerda (mangá)"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setSettingsOpen(false)}
              className="w-full rounded-xl bg-elevated py-2 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
