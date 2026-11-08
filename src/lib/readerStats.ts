import { prisma } from "./db";

export type Period = "7d" | "30d" | "all";
export type SortKey = "chapters" | "pages" | "works" | "days" | "streak" | "level";

export const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "all", label: "Sempre", days: null },
];

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "chapters", label: "Capítulos" },
  { id: "pages", label: "Páginas" },
  { id: "works", label: "Obras" },
  { id: "days", label: "Dias ativos" },
  { id: "streak", label: "Sequência" },
  { id: "level", label: "Nível" },
];

export type Badge = { id: string; label: string; hint: string };

export type PeriodStats = { chapters: number; pages: number; works: number; days: number };

export type ReaderStats = {
  user: { id: number; username: string; displayName: string | null; avatarUrl: string | null; isAdmin: boolean };
  period: PeriodStats;
  total: PeriodStats;
  completed: number;
  streak: number;
  bestStreak: number;
  night: number;
  xp: number;
  level: number;
  levelFloor: number;
  nextLevelAt: number;
  badges: Badge[];
  lastReadAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "America/Sao_Paulo";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });

const dayKey = (d: Date) => dayFmt.format(d);
const dayIndex = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);

export const xpFloor = (level: number) => 50 * (level - 1) ** 2;
const levelFromXp = (xp: number) => Math.floor(Math.sqrt(xp / 50)) + 1;

const LADDERS: { id: string; value: (s: ReaderStats) => number; steps: number[]; label: (n: number) => string; hint: (n: number) => string }[] = [
  { id: "chapters", value: (s) => s.total.chapters, steps: [100, 500, 1000, 5000], label: (n) => `${n.toLocaleString("pt-BR")} capítulos`, hint: (n) => `${n.toLocaleString("pt-BR")} capítulos lidos` },
  { id: "streak", value: (s) => s.bestStreak, steps: [7, 30, 100], label: (n) => `${n} dias seguidos`, hint: (n) => `Leu ${n} dias seguidos` },
  { id: "works", value: (s) => s.total.works, steps: [25, 100, 250], label: (n) => `${n} obras`, hint: (n) => `Leu capítulos de ${n} obras` },
  { id: "completed", value: (s) => s.completed, steps: [10, 50], label: (n) => `${n} concluídas`, hint: (n) => `${n} obras marcadas como concluídas` },
  { id: "night", value: (s) => s.night, steps: [50, 500], label: () => "Coruja", hint: (n) => `${n} capítulos lidos entre 0h e 5h` },
];

function earnedBadges(s: ReaderStats): Badge[] {
  const out: Badge[] = [];
  for (const l of LADDERS) {
    const v = l.value(s);
    const step = [...l.steps].reverse().find((n) => v >= n);
    if (step != null) out.push({ id: `${l.id}-${step}`, label: l.label(step), hint: l.hint(step) });
  }
  return out;
}

function streaks(days: Set<string>, today: string): { current: number; best: number } {
  const idx = [...days].map(dayIndex).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < idx.length; i++) {
    run = i > 0 && idx[i] === idx[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const last = idx[idx.length - 1];
  const current = last != null && dayIndex(today) - last <= 1 ? run : 0;
  return { current, best };
}

const emptyPeriod = (): PeriodStats => ({ chapters: 0, pages: 0, works: 0, days: 0 });

// One pass over the reading history; it only holds chapters actually opened.
export async function computeReaderStats(period: Period = "all"): Promise<ReaderStats[]> {
  const days = PERIODS.find((p) => p.id === period)?.days ?? null;
  const since = days ? Date.now() - days * DAY_MS : 0;
  const now = new Date();
  const today = dayKey(now);

  const [users, history, completed] = await Promise.all([
    prisma.user.findMany({ select: { id: true, username: true, displayName: true, avatarUrl: true, isAdmin: true } }),
    prisma.readingHistory.findMany({ select: { userId: true, workId: true, lastPageRead: true, readAt: true } }),
    prisma.favorite.groupBy({ by: ["userId"], where: { status: "COMPLETED" }, _count: true }),
  ]);

  type Acc = {
    total: PeriodStats; period: PeriodStats; works: Set<number>; periodWorks: Set<number>;
    days: Set<string>; periodDays: Set<string>; night: number; lastReadAt: Date | null;
  };
  const acc = new Map<number, Acc>();
  for (const h of history) {
    let a = acc.get(h.userId);
    if (!a) {
      a = { total: emptyPeriod(), period: emptyPeriod(), works: new Set(), periodWorks: new Set(), days: new Set(), periodDays: new Set(), night: 0, lastReadAt: null };
      acc.set(h.userId, a);
    }
    const pages = Math.max(0, h.lastPageRead) + 1;
    const key = dayKey(h.readAt);
    a.total.chapters++;
    a.total.pages += pages;
    a.works.add(h.workId);
    a.days.add(key);
    if (Number(hourFmt.format(h.readAt)) < 5) a.night++;
    if (!a.lastReadAt || h.readAt > a.lastReadAt) a.lastReadAt = h.readAt;
    if (h.readAt.getTime() >= since) {
      a.period.chapters++;
      a.period.pages += pages;
      a.periodWorks.add(h.workId);
      a.periodDays.add(key);
    }
  }

  const completedBy = new Map(completed.map((c) => [c.userId, c._count]));

  return users.map((user) => {
    const a = acc.get(user.id);
    const total = a ? { ...a.total, works: a.works.size, days: a.days.size } : emptyPeriod();
    const periodStats = a ? { ...a.period, works: a.periodWorks.size, days: a.periodDays.size } : emptyPeriod();
    const { current, best } = a ? streaks(a.days, today) : { current: 0, best: 0 };
    const done = completedBy.get(user.id) ?? 0;
    const xp = total.chapters * 10 + done * 100 + total.days * 25;
    const level = levelFromXp(xp);
    const s: ReaderStats = {
      user,
      period: periodStats,
      total,
      completed: done,
      streak: current,
      bestStreak: best,
      night: a?.night ?? 0,
      xp,
      level,
      levelFloor: xpFloor(level),
      nextLevelAt: xpFloor(level + 1),
      badges: [],
      lastReadAt: a?.lastReadAt ?? null,
    };
    s.badges = earnedBadges(s);
    return s;
  });
}

export function sortValue(s: ReaderStats, key: SortKey): number {
  switch (key) {
    case "chapters": return s.period.chapters;
    case "pages": return s.period.pages;
    case "works": return s.period.works;
    case "days": return s.period.days;
    case "streak": return s.streak;
    case "level": return s.xp;
  }
}

export function rankReaders(list: ReaderStats[], key: SortKey): ReaderStats[] {
  return [...list].sort(
    (a, b) =>
      sortValue(b, key) - sortValue(a, key) ||
      b.period.chapters - a.period.chapters ||
      a.user.username.localeCompare(b.user.username),
  );
}

export type ProfileGameStats = { stats: ReaderStats; rank: number; of: number };

export async function profileGameStats(userId: number): Promise<ProfileGameStats | null> {
  const ranked = rankReaders(await computeReaderStats("all"), "level");
  const i = ranked.findIndex((s) => s.user.id === userId);
  return i < 0 ? null : { stats: ranked[i], rank: i + 1, of: ranked.length };
}
