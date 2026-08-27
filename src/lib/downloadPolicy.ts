// Server-side rules the download queue obeys: disk quota, age cleanup, free
// space floor, allowed hours and a manual pause. One row, id 1.

import { prisma } from "@/lib/db";

export type Policy = {
  quotaMb: number;
  perUserQuotaMb: number;
  keepDays: number;
  minFreeGb: number;
  windowStart: string;
  windowEnd: string;
  paused: boolean;
};

export type Gate = {
  open: boolean;
  reason: "paused" | "window" | "disk" | null;
  detail: string | null;
};

export const DEFAULT_POLICY: Policy = {
  quotaMb: 0,
  perUserQuotaMb: 0,
  keepDays: 0,
  minFreeGb: 2,
  windowStart: "",
  windowEnd: "",
  paused: false,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function intOr(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i >= 0 ? i : fallback;
}

function timeOf(value: unknown): string {
  return typeof value === "string" && TIME.test(value.trim()) ? value.trim() : "";
}

export async function getPolicy(): Promise<Policy> {
  try {
    const row = await prisma.downloadPolicy.findUnique({ where: { id: 1 } });
    if (!row) return DEFAULT_POLICY;
    return {
      quotaMb: row.quotaMb,
      perUserQuotaMb: row.perUserQuotaMb,
      keepDays: row.keepDays,
      minFreeGb: row.minFreeGb,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      paused: row.paused,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function savePolicy(input: Partial<Policy>): Promise<Policy> {
  const current = await getPolicy();
  const next: Policy = {
    quotaMb: input.quotaMb === undefined ? current.quotaMb : intOr(input.quotaMb, current.quotaMb),
    perUserQuotaMb:
      input.perUserQuotaMb === undefined
        ? current.perUserQuotaMb
        : intOr(input.perUserQuotaMb, current.perUserQuotaMb),
    keepDays:
      input.keepDays === undefined ? current.keepDays : intOr(input.keepDays, current.keepDays),
    minFreeGb:
      input.minFreeGb === undefined ? current.minFreeGb : intOr(input.minFreeGb, current.minFreeGb),
    windowStart: input.windowStart === undefined ? current.windowStart : timeOf(input.windowStart),
    windowEnd: input.windowEnd === undefined ? current.windowEnd : timeOf(input.windowEnd),
    paused: input.paused === undefined ? current.paused : Boolean(input.paused),
  };

  try {
    await prisma.downloadPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, ...next },
      update: next,
    });
  } catch {
    return current;
  }
  return next;
}

function minutesOf(hhmm: string): number | null {
  if (!TIME.test(hhmm)) return null;
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function windowOpen(policy: Policy, now: Date = new Date()): boolean {
  const start = minutesOf(policy.windowStart);
  const end = minutesOf(policy.windowEnd);
  if (start === null || end === null) return true;
  if (start === end) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function queueGate(policy: Policy, freeBytes: number): Gate {
  if (policy.paused) return { open: false, reason: "paused", detail: "Fila pausada" };
  if (!windowOpen(policy)) {
    return {
      open: false,
      reason: "window",
      detail: `Fora da janela (${policy.windowStart}–${policy.windowEnd})`,
    };
  }
  if (policy.minFreeGb > 0 && freeBytes < policy.minFreeGb * 1024 * 1024 * 1024) {
    return { open: false, reason: "disk", detail: "Pouco espaço em disco" };
  }
  return { open: true, reason: null, detail: null };
}
