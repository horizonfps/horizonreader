import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const MAX_LEN = 500;

const FIELDS = ["displayName", "avatarUrl", "bannerUrl", "bio"] as const;
type Field = (typeof FIELDS)[number];

// Avatar/banner must point at an app-hosted upload; empty clears the field.
// Anything else (external URLs included) is ignored.
const MEDIA_URL = /^\/api\/media\/[a-zA-Z0-9._-]+$/;
function isImageField(key: Field): boolean {
  return key === "avatarUrl" || key === "bannerUrl";
}

// GET: the session user's public profile fields.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.uid },
      select: { displayName: true, avatarUrl: true, bannerUrl: true, bio: true },
    });
    return NextResponse.json({
      displayName: user?.displayName ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      bannerUrl: user?.bannerUrl ?? null,
      bio: user?.bio ?? null,
    });
  } catch {
    return NextResponse.json({
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    });
  }
}

// POST: update only the provided profile fields (trimmed, length-capped).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Partial<Record<Field, unknown>>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const data: Partial<Record<Field, string>> = {};
  for (const key of FIELDS) {
    const raw = body[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, MAX_LEN);
    if (isImageField(key) && value && !MEDIA_URL.test(value)) continue;
    data[key] = value;
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true });

  try {
    const user = await prisma.user.update({
      where: { id: session.uid },
      data,
      select: { displayName: true, avatarUrl: true, bannerUrl: true, bio: true },
    });
    return NextResponse.json({ ok: true, ...user });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 200 });
  }
}
