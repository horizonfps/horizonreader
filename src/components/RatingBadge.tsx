import { Star } from "lucide-react";

// Asura-style gold-star rating badge, positioned for a relative cover box.
export default function RatingBadge({ rating }: { rating?: number | null }) {
  if (rating == null) return null;
  return (
    <span className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-text backdrop-blur">
      <Star className="h-3 w-3 fill-accent text-accent" />
      {rating.toFixed(1)}
    </span>
  );
}
