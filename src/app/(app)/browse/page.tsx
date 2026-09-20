import BrowseFilters from "@/components/BrowseFilters";
import InfiniteGrid from "@/components/InfiniteGrid";
import { getBrowseGenres } from "@/lib/backbone/sections";

export const dynamic = "force-dynamic";

export const metadata = { title: "Explorar" };

const TYPES = new Set(["manga", "manhwa", "manhua"]);
const SORTS = new Set(["popular", "latest", "rating", "new"]);
const STATUSES = new Set(["ongoing", "completed", "hiatus"]);

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; genre?: string; sort?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const type = TYPES.has(sp.type ?? "") ? sp.type! : "";
  const genre = (sp.genre ?? "").trim();
  const sort = SORTS.has(sp.sort ?? "") ? sp.sort! : "popular";
  const status = STATUSES.has(sp.status ?? "") ? sp.status! : "";

  const genres = await getBrowseGenres().catch(() => []);

  const p = new URLSearchParams();
  if (type) p.set("type", type);
  if (genre) p.set("genre", genre);
  if (status) p.set("status", status);
  p.set("sort", sort);
  const qs = p.toString();
  const endpoint = `/api/browse?${qs}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Explorar</h1>
      <BrowseFilters genres={genres} current={{ type, genre, sort, status }} />
      <InfiniteGrid key={qs} endpoint={endpoint} initialKeyReset={qs} />
    </div>
  );
}
