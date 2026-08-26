import { getSession } from "@/lib/session";
import DownloadsPanel from "@/components/DownloadsPanel";

export const dynamic = "force-dynamic";

export default async function DownloadsPage() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Downloads</h1>
      <DownloadsPanel />
    </div>
  );
}
