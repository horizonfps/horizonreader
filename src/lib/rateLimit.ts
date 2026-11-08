import type { NextRequest } from "next/server";

const MAX_KEYS = 5000;

// In-memory fixed-window limiter; returns true once a key exceeds `max` hits.
export function createRateLimiter(windowMs: number) {
  const attempts = new Map<string, { count: number; resetAt: number }>();

  function pruneExpired(now: number) {
    if (attempts.size < MAX_KEYS) return;
    for (const [k, v] of attempts) {
      if (now > v.resetAt) attempts.delete(k);
    }
  }

  return function rateLimited(key: string, max: number): boolean {
    const now = Date.now();
    pruneExpired(now);
    const entry = attempts.get(key);
    if (!entry || now > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  };
}

export function clientKey(req: NextRequest): string {
  // cf-connecting-ip is set by Cloudflare (the expected deploy front).
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  return `ip:${ip.toLowerCase()}`;
}
