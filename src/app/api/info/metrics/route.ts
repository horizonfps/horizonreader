import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { dockerInfo, listContainerMetrics } from "@/lib/metrics/docker";
import { readHost } from "@/lib/metrics/host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [host, containers, docker] = await Promise.all([
    readHost().catch(() => ({ available: false as const, procPath: null })),
    listContainerMetrics().catch((err: Error) => ({ error: err.message })),
    dockerInfo().catch((err: Error) => ({ error: err.message })),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    host,
    containers: Array.isArray(containers) ? containers : [],
    containersError: Array.isArray(containers) ? null : containers.error,
    docker: "error" in docker ? null : docker,
    dockerError: "error" in docker ? docker.error : null,
  });
}
