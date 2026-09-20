// User-facing labels for backbone enums. Isomorphic.

const TYPE: Record<string, string> = {
  manga: "Mangá",
  manhwa: "Manhwa",
  manhua: "Manhua",
  other: "Comic",
};

const STATUS: Record<string, string> = {
  ongoing: "Em andamento",
  completed: "Completo",
  hiatus: "Em hiato",
  cancelled: "Cancelado",
};

export function typeLabel(t?: string | null): string {
  if (!t) return "";
  return TYPE[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

export function statusLabel(s?: string | null): string {
  if (!s) return "";
  return STATUS[s] ?? "";
}

export function formatCount(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

const UNITS: [number, string, string][] = [
  [60, "min", "min"],
  [24, "h", "h"],
  [7, "dia", "dias"],
  [4.35, "sem", "sem"],
  [12, "mês", "meses"],
  [Infinity, "ano", "anos"],
];

// Compact relative time in Portuguese.
export function timeAgo(input: number | string | Date | null | undefined, now = Date.now()): string {
  if (input == null || input === "") return "";
  let t: number;
  if (input instanceof Date) t = input.getTime();
  else if (typeof input === "number") t = input;
  else {
    const n = Number(input);
    t = Number.isFinite(n) && n > 0 ? n : Date.parse(input);
  }
  if (!Number.isFinite(t) || t <= 0) return "";
  let diff = Math.max(0, now - t) / 60_000;
  if (diff < 1) return "agora";
  for (const [size, one, many] of UNITS) {
    if (diff < size) {
      const v = Math.floor(diff);
      return `há ${v} ${v === 1 ? one : many}`;
    }
    diff /= size;
  }
  return "";
}
