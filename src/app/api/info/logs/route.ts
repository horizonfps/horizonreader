import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { collectLogs } from "@/lib/metrics/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const tail = Math.min(Math.max(Number(params.get("tail")) || 250, 20), 2_000);
  const container = params.get("container") || undefined;

  try {
    const result = await collectLogs({ tail, container });
    return NextResponse.json({ generatedAt: new Date().toISOString(), tail, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
