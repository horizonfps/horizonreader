import { randomBytes } from "node:crypto";
import { prisma } from "./db";

export const INVITE_TTL_DAYS = 7;
export const MAX_PENDING_INVITES = 3;

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
export const PASSWORD_MIN = 6;

export function newInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export function inviteExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name);
}

// SQLite compares case-sensitively; usernames must stay unique ignoring case.
export async function usernameTaken(name: string): Promise<boolean> {
  const lower = name.toLowerCase();
  const users = await prisma.user.findMany({ select: { username: true } });
  return users.some((u) => u.username.toLowerCase() === lower);
}

export async function findUsableInvite(code: string) {
  if (!code || code.length > 64) return null;
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: { createdBy: { select: { username: true, displayName: true, avatarUrl: true, isAdmin: true } } },
  });
  if (!invite || invite.usedById != null || invite.usedAt != null) return null;
  if (invite.expiresAt.getTime() <= Date.now()) return null;
  return invite;
}

export async function pendingInviteCount(userId: number): Promise<number> {
  return prisma.invite.count({
    where: { createdById: userId, usedAt: null, expiresAt: { gt: new Date() } },
  });
}
