// Shrinks a cover to card size and re-encodes it as WebP, so every cache tier
// holds one small, uniform format regardless of what the source served.

type SharpModule = { default: typeof import("sharp") };
let sharpModule: Promise<SharpModule> | null = null;

// Lazy module load so a broken sharp install never fails the route on import.
function loadSharp(): Promise<SharpModule> {
  if (!sharpModule) sharpModule = import("sharp") as unknown as Promise<SharpModule>;
  return sharpModule;
}

export async function shrinkCover(
  body: Uint8Array,
  contentType: string,
): Promise<{ body: Uint8Array; contentType: string }> {
  // GIF is skipped so an animated cover keeps its animation.
  if (!contentType.startsWith("image/") || contentType === "image/gif") {
    return { body, contentType };
  }
  try {
    const { default: sharp } = await loadSharp();
    const out = await sharp(body)
      .resize({ width: 360, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    return { body: new Uint8Array(out), contentType: "image/webp" };
  } catch {
    // Sharp missing, or a decode failure: keep the original bytes.
    return { body, contentType };
  }
}
