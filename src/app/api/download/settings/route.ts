import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { downloadsSnapshot, enforceStorage, runQueue } from "@/lib/downloads";
import { savePolicy, type Policy } from "@/lib/downloadPolicy";

export const runtime = "nodejs";

function parsePolicy(body: unknown): Partial<Policy> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<Policy> = {};
  if (b.quotaMb !== undefined) out.quotaMb = Number(b.quotaMb);
  if (b.perUserQuotaMb !== undefined) out.perUserQuotaMb = Number(b.perUserQuotaMb);
  if (b.keepDays !== undefined) out.keepDays = Number(b.keepDays);
  if (b.minFreeGb !== undefined) out.minFreeGb = Number(b.minFreeGb);
  if (b.windowStart !== undefined) out.windowStart = String(b.windowStart);
  if (b.windowEnd !== undefined) out.windowEnd = String(b.windowEnd);
  if (b.paused !== undefined) out.paused = Boolean(b.paused);
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { policy, gate, storage } = await downloadsSnapshot();
  return NextResponse.json({ policy, gate, storage });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const policy = await savePolicy(parsePolicy(body));
  void runQueue();
  return NextResponse.json({ ok: true, policy });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "cleanup") {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  const { removed, bytesFreed } = await enforceStorage();
  return NextResponse.json({ ok: true, removed, bytesFreed });
}
