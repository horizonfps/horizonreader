import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/jwt";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

// A session whose account no longer exists lands here from the app layout.
export async function GET() {
  const res = new NextResponse(null, { status: 307, headers: { Location: "/login" } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
