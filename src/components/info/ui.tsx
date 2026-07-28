"use client";

// Shared primitives and formatters for the infra panel.

const nf = (digits: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${nf(size >= 100 || unit === 0 ? 0 : 1).format(size)} ${units[unit]}`;
}

export function rate(value: number | null | undefined): string {
  return value == null ? "—" : `${bytes(value)}/s`;
}

export function pct(value: number | null | undefined, digits = 0): string {
  return value == null || !Number.isFinite(value) ? "—" : `${nf(digits).format(value)}%`;
}

export function count(value: number | null | undefined): string {
  return value == null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const delta = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(delta)) return "—";
  if (delta < 60) return "agora";
  return `há ${duration(delta)}`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export type Tone = "ok" | "warn" | "bad" | "idle";

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
  idle: "text-muted",
};

export const TONE_BG: Record<Tone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
  idle: "bg-muted",
};

export const TONE_STROKE: Record<Tone, string> = {
  ok: "stroke-emerald-400",
  warn: "stroke-amber-400",
  bad: "stroke-red-400",
  idle: "stroke-muted",
};

export function toneFor(value: number | null | undefined, warn: number, bad: number): Tone {
  if (value == null || !Number.isFinite(value)) return "idle";
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "ok";
}

export function Card({
  title,
  action,
  className = "",
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      {title || action ? (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const ring: Record<Tone, string> = {
    ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    bad: "border-red-400/30 bg-red-400/10 text-red-300",
    idle: "border-border bg-elevated text-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${ring[tone]}`}
    >
      <i className={`h-1.5 w-1.5 rounded-full ${TONE_BG[tone]}`} />
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "idle",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone === "idle" ? "text-text" : TONE_TEXT[tone]}`}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}

export function Bar({ value, tone = "ok", className = "" }: { value: number; tone?: Tone; className?: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-elevated ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${TONE_BG[tone]}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Ring({
  value,
  label,
  caption,
  tone,
}: {
  value: number | null;
  label: string;
  caption?: string;
  tone: Tone;
}) {
  const safe = value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[104px] w-[104px]">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} className="fill-none stroke-elevated" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            className={`fill-none transition-all duration-700 ${TONE_STROKE[tone]}`}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - safe / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
            {value == null ? "—" : pct(safe)}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-xs font-medium text-text">{label}</p>
      {caption ? <p className="text-[11px] tabular-nums text-muted">{caption}</p> : null}
    </div>
  );
}

export function Sparkline({ points, tone = "ok" }: { points: number[]; tone?: Tone }) {
  if (points.length < 2) return <div className="h-10" />;
  const width = 240;
  const height = 40;
  const max = Math.max(100, ...points);
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(height - (p / max) * height).toFixed(1)}`);
  const stroke: Record<Tone, string> = {
    ok: "stroke-accent",
    warn: "stroke-amber-400",
    bad: "stroke-red-400",
    idle: "stroke-muted",
  };
  const fill: Record<Tone, string> = {
    ok: "fill-accent/10",
    warn: "fill-amber-400/10",
    bad: "fill-red-400/10",
    idle: "fill-muted/10",
  };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-10 w-full">
      <polygon className={fill[tone]} points={`0,${height} ${coords.join(" ")} ${width},${height}`} />
      <polyline className={`fill-none ${stroke[tone]}`} strokeWidth="1.5" points={coords.join(" ")} />
    </svg>
  );
}
