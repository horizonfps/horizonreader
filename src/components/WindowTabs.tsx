"use client";

import { useState } from "react";
import type { Card } from "@/lib/cards";
import { workHref } from "@/lib/cards";
import CardRow from "@/components/CardRow";

type Tab = { key: string; label: string; items: Card[] };

const ROW_LIMIT = 30;

export default function WindowTabs({
  title,
  tabs,
}: {
  title: string;
  tabs: Tab[];
}) {
  const visible = tabs.filter((t) => t.items.length > 0);
  const [active, setActive] = useState(0);
  if (!visible.length) return null;

  const current = visible[Math.min(active, visible.length - 1)];
  const rowItems = current.items.slice(0, ROW_LIMIT).map((it) => ({
    href: workHref(it),
    title: it.title,
    coverUrl: it.coverUrl,
    rating: it.rating,
    type: it.type,
  }));
  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-semibold text-text">{title}</h2>
        {visible.map((t, i) => {
          const on = i === Math.min(active, visible.length - 1);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(i)}
              className={
                on
                  ? "rounded-full bg-accent px-3 py-1 text-xs font-medium text-on-accent"
                  : "rounded-full bg-elevated px-3 py-1 text-xs text-muted hover:text-text"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <CardRow items={rowItems} />
    </section>
  );
}
