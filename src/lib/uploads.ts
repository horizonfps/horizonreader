import { join } from "node:path";

// Persistent store for user-uploaded avatars/banners, served via /api/media.
// Overridable so Docker can target the mounted data volume.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "data", "uploads");
