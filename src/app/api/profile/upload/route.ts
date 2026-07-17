import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSession } from "@/lib/session";
import { UPLOAD_DIR } from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

// Extension comes from the file's magic bytes; the client-declared MIME type
// is never trusted.
function sniffImageExt(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  if (buf.subarray(4, 12).toString("latin1") === "ftypavif") return "avif";
  return null;
}

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

  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImageExt(buf);
  if (!ext) return NextResponse.json({ error: "unsupported type" }, { status: 415 });
  const name = `${session.uid}-${randomUUID()}.${ext}`;

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, name), buf);
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

  return NextResponse.json({ url: `/api/media/${name}` });
}
