"use client";

import { useState } from "react";
import type { Card } from "@/lib/cards";
import { workHref } from "@/lib/cards";
import CardRow from "@/components/CardRow";
import SectionHeader from "@/components/SectionHeader";

type Tab = { key: string; label: string; items: Card[] };

const ROW_LIMIT = 30;

export default function WindowTabs({
  title,
  tabs,
  href,
}: {
  title: string;
  tabs: Tab[];
  href?: string;
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
    <section>
      <SectionHeader title={title} href={href}>
        <div className="flex gap-1 rounded-full bg-surface p-0.5">
          {visible.map((t, i) => {
            const on = i === Math.min(active, visible.length - 1);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  on ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-text"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </SectionHeader>
      <CardRow items={rowItems} />
    </section>
  );
}
