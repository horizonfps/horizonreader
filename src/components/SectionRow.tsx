import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Card } from "@/lib/cards";
import { workHref } from "@/lib/cards";
import CardRow from "@/components/CardRow";

const ROW_LIMIT = 30;

export default function SectionRow({
  title,
  items,
  href,
}: {
  title: string;
  items: Card[];
  href?: string;
}) {
  if (!items.length) return null;
  const rowItems = items.slice(0, ROW_LIMIT).map((it) => ({
    href: workHref(it),
    title: it.title,
    coverUrl: it.coverUrl,
    rating: it.rating,
    type: it.type,
  }));
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="flex items-center gap-0.5 text-xs text-muted hover:text-text"
          >
            See all
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
      <CardRow items={rowItems} />
    </section>
  );
}
