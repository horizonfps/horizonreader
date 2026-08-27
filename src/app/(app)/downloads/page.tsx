import { getSession } from "@/lib/session";
import DownloadsPanel from "@/components/DownloadsPanel";
import OfflineAutoSaveToggle from "@/components/OfflineAutoSaveToggle";

export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Downloads</h1>
      {/* Plain anchor: the service worker only sees document navigations. */}
      <a href="/offline" className="inline-block text-sm text-muted underline">
        Salvos no celular
      </a>
      <OfflineAutoSaveToggle />
      <DownloadsPanel />
    </div>
  );
}
