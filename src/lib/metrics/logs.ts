// Container log tailing with severity classification, so the panel can show an
// error feed instead of a wall of text.

import { containerLogs, listContainerNames } from "./docker";

export type LogLevel = "error" | "warn" | "info" | "debug";

export type LogEntry = {
  container: string;
  at: string | null;
  level: LogLevel;
  stream: "stdout" | "stderr";
  message: string;
};

export type LogGroup = {
  signature: string;
  sample: string;
  container: string;
  level: LogLevel;
  count: number;
  lastAt: string | null;
};

export type ContainerLogSummary = {
  container: string;
  state: string;
  lines: number;
  error: number;
  warn: number;
  lastError: LogEntry | null;
  failed: string | null;
};

const ANSI = /\[[0-9;?]*[a-zA-Z]/g;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s?/;
const LEVEL_TOKEN = /\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|SEVERE|PANIC)\b/;
const KEYED_LEVEL = /(?:"level"\s*:\s*"|level=)(\w+)/i;
const ERROR_HINT =
  /(exception|traceback|panic:|stack trace|unhandled|segmentation fault|out of memory|oomkill|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOSPC|EACCES|failed to |cannot connect|could not connect|no such file|permission denied|connection refused|⨯)/i;
const WARN_HINT = /(deprecat|retrying|timed out|timeout|slow query|⚠)/i;

function levelOf(message: string): LogLevel {
  const head = message.slice(0, 140);
  const keyed = head.match(KEYED_LEVEL)?.[1] || head.match(LEVEL_TOKEN)?.[1];
  switch (keyed?.toUpperCase()) {
    case "ERROR":
    case "ERR":
    case "FATAL":
    case "CRITICAL":
    case "SEVERE":
    case "PANIC":
      return "error";
    case "WARN":
    case "WARNING":
      return "warn";
    case "INFO":
    case "NOTICE":
      return "info";
    case "DEBUG":
    case "TRACE":
      return "debug";
  }
  if (ERROR_HINT.test(head)) return "error";
  if (WARN_HINT.test(head)) return "warn";
  return "info";
}

function parse(container: string, chunks: { stream: "stdout" | "stderr"; text: string }[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const chunk of chunks) {
    for (const raw of chunk.text.split("\n")) {
      const line = raw.replace(ANSI, "").replace(/\r/g, "").trimEnd();
      if (!line.trim()) continue;
      const stamp = line.match(TIMESTAMP);
      const message = stamp ? line.slice(stamp[0].length) : line;
      if (!message.trim()) continue;
      entries.push({
        container,
        at: stamp?.[1] ?? null,
        level: levelOf(message),
        stream: chunk.stream,
        message: message.slice(0, 2_000),
      });
    }
  }
  return entries;
}

// Collapse ids, hashes and numbers so repeats of the same failure group up.
function signature(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export async function collectLogs(options: { tail: number; container?: string }) {
  const names = await listContainerNames();
  const targets = options.container ? names.filter((c) => c.name === options.container) : names;

  const perContainer = await Promise.all(
    targets.map(async (c) => {
      try {
        const entries = parse(c.name, await containerLogs(c.id, options.tail));
        return { container: c, entries, failed: null as string | null };
      } catch (err) {
        return { container: c, entries: [] as LogEntry[], failed: (err as Error).message };
      }
    }),
  );

  const all = perContainer.flatMap((r) => r.entries);
  all.sort((a, b) => (a.at || "").localeCompare(b.at || ""));

  const summaries: ContainerLogSummary[] = perContainer.map((r) => {
    const errors = r.entries.filter((e) => e.level === "error");
    return {
      container: r.container.name,
      state: r.container.state,
      lines: r.entries.length,
      error: errors.length,
      warn: r.entries.filter((e) => e.level === "warn").length,
      lastError: errors[errors.length - 1] ?? null,
      failed: r.failed,
    };
  });

  const groups = new Map<string, LogGroup>();
  for (const entry of all) {
    if (entry.level !== "error" && entry.level !== "warn") continue;
    const key = `${entry.container}|${signature(entry.message)}`;
    const hit = groups.get(key);
    if (hit) {
      hit.count += 1;
      hit.lastAt = entry.at ?? hit.lastAt;
      if (entry.level === "error") hit.level = "error";
    } else {
      groups.set(key, {
        signature: key,
        sample: entry.message,
        container: entry.container,
        level: entry.level,
        count: 1,
        lastAt: entry.at,
      });
    }
  }

  return {
    containers: summaries.sort((a, b) => b.error - a.error || a.container.localeCompare(b.container)),
    entries: all.slice(-600),
    groups: [...groups.values()]
      .sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === "error" ? -1 : 1))
      .slice(0, 20),
  };
}
