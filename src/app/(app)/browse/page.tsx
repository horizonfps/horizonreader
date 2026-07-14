import BrowseFilters from "@/components/BrowseFilters";
import InfiniteGrid from "@/components/InfiniteGrid";
import { getBrowseGenres } from "@/lib/backbone/sections";

export const dynamic = "force-dynamic";

const TYPES = new Set(["manga", "manhwa", "manhua"]);
const SORTS = new Set(["popular", "latest", "rating", "new"]);

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; genre?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const type = TYPES.has(sp.type ?? "") ? sp.type! : "";
  const genre = (sp.genre ?? "").trim();
  const sort = SORTS.has(sp.sort ?? "") ? sp.sort! : "popular";

  const genres = await getBrowseGenres().catch(() => []);

  const p = new URLSearchParams();
  if (type) p.set("type", type);
  if (genre) p.set("genre", genre);
  p.set("sort", sort);
  const qs = p.toString();
  const endpoint = `/api/browse?${qs}`;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Explorar</h1>
      <BrowseFilters genres={genres} current={{ type, genre, sort }} />
      <InfiniteGrid key={qs} endpoint={endpoint} initialKeyReset={qs} />
    </div>
  );
}
