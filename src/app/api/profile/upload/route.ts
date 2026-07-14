import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSession } from "@/lib/session";
import { UPLOAD_DIR } from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

// Accept an avatar/banner image file and store it under data/uploads, returning
// an app-relative URL served (auth-gated) by /api/media.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  const ext = EXT_BY_MIME[file.type];
  if (!ext) return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const name = `${session.uid}-${randomUUID()}.${ext}`;

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, name), buf);
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

  return NextResponse.json({ url: `/api/media/${name}` });
}
