import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSession } from "@/lib/session";
import { UPLOAD_DIR } from "@/lib/uploads";

export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

// Serve a stored upload. Auth-gated (private) and name-validated (no traversal).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = await params;
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const type = CONTENT_TYPE[ext];
  if (!type) return NextResponse.json({ error: "bad type" }, { status: 400 });

  try {
    const data = await readFile(join(UPLOAD_DIR, name));
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
