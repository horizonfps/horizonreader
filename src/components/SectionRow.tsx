import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Card } from "@/lib/cards";
import CardGrid from "@/components/CardGrid";

const SECTION_LIMIT = 8;

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
      <CardGrid items={items} limit={SECTION_LIMIT} />
    </section>
  );
}
