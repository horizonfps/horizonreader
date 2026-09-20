import PrefetchLink from "@/components/PrefetchLink";
import { coverProxy, workHref } from "@/lib/cards";
import { timeAgo } from "@/lib/labels";
import type { LatestUpdate } from "@/lib/backbone/latest";

const LANG_LABEL: Record<string, string> = { "pt-br": "PT", en: "EN" };

function chapterLabel(c: LatestUpdate["chapters"][number]): string {
  const parts: string[] = [];
  if (c.volume) parts.push(`Vol. ${c.volume}`);
  if (c.chapter) parts.push(`Cap. ${c.chapter}`);
  if (!parts.length) return c.title || "Oneshot";
  return parts.join(" ");
}

export default function LatestUpdates({ updates, now }: { updates: LatestUpdate[]; now: number }) {
  if (!updates.length) return null;
  return (
    <div className="grid gap-x-6 gap-y-1 md:grid-cols-2 2xl:grid-cols-3">
      {updates.map((u) => {
        const src = coverProxy(u.work.coverUrl);
        const href = workHref(u.work);
        return (
          <div
            key={`${u.work.origin}:${u.work.externalId}`}
            className="flex gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-surface"
          >
            <PrefetchLink href={href} className="block h-[5.25rem] w-14 shrink-0 overflow-hidden rounded bg-surface">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" loading="lazy" draggable={false} className="cover-img h-full w-full object-cover" />
              ) : null}
            </PrefetchLink>
            <div className="min-w-0 flex-1">
              <PrefetchLink href={href} className="block truncate text-sm font-semibold text-text hover:text-accent">
                {u.work.title}
              </PrefetchLink>
              <ul className="mt-1 space-y-1">
                {u.chapters.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] leading-4 text-muted">
                      {LANG_LABEL[c.lang] ?? c.lang.toUpperCase()}
                    </span>
                    <span className="truncate text-text">
                      {chapterLabel(c)}
                      {c.title && (c.chapter || c.volume) ? (
                        <span className="text-muted"> · {c.title}</span>
                      ) : null}
                    </span>
                    <span className="ml-auto shrink-0 text-muted">{timeAgo(c.readableAt, now)}</span>
                  </li>
                ))}
              </ul>
              {u.chapters[0]?.group ? (
                <p className="mt-1 truncate text-[11px] text-muted">{u.chapters[0].group}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
