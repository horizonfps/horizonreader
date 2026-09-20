import { getSession } from "@/lib/session";
import DownloadsPanel from "@/components/DownloadsPanel";
import OfflineAutoSaveToggle from "@/components/OfflineAutoSaveToggle";

export const dynamic = "force-dynamic";

export const metadata = { title: "Downloads" };

export default async function DownloadsPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Downloads</h1>
        {/* Plain anchor: the service worker only sees document navigations. */}
        <a
          href="/offline"
          className="ml-auto rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:bg-elevated hover:text-text"
        >
          Salvos no celular
        </a>
      </div>
      <OfflineAutoSaveToggle />
      <DownloadsPanel />
    </div>
  );
}
