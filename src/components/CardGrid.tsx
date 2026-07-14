import type { Card } from "@/lib/cards";
import MangaCard from "@/components/MangaCard";

// 4-per-row on wide screens, 3 on phones. Shared by home sections and grids.
export default function CardGrid({ items, limit }: { items: Card[]; limit?: number }) {
  const shown = typeof limit === "number" ? items.slice(0, limit) : items;
  const seen = new Set<string>();
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {shown.map((item) => {
        const key = `${item.origin}:${item.externalId}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return <MangaCard key={key} item={item} />;
      })}
    </div>
  );
}
