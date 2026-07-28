import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readServices } from "@/lib/metrics/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const services = await readServices();
  return NextResponse.json({ generatedAt: new Date().toISOString(), ...services });
}
