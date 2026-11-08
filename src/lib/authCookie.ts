import type { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE, type SessionPayload } from "./jwt";

function cookieSecure(): boolean {
  const flag = process.env.COOKIE_SECURE;
  if (flag != null) return flag === "true";
  return process.env.NODE_ENV === "production";
}

export async function setSessionCookie(res: NextResponse, payload: SessionPayload) {
  const token = await createSessionToken(payload);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}
