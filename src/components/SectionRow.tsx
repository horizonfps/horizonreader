import type { Card } from "@/lib/cards";
import { workHref } from "@/lib/cards";
import CardRow from "@/components/CardRow";
import SectionHeader from "@/components/SectionHeader";

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
    <section>
      <SectionHeader title={title} href={href} />
      <CardRow items={rowItems} />
    </section>
  );
}
