// Host machine metrics straight from procfs. The compose file bind-mounts the
// VPS /proc read-only, so this reports the physical box and not the container.

import { existsSync } from "node:fs";
import { readdir, readFile, statfs } from "node:fs/promises";
import { join } from "node:path";

const PROC = resolveProc();
const DISK_PATH = process.env.HOST_DISK_PATH || (existsSync("/data") ? "/data" : "/");

function resolveProc(): string {
  const env = process.env.HOST_PROC;
  if (env && existsSync(join(env, "stat"))) return env;
  if (existsSync("/host/proc/stat")) return "/host/proc";
  return "/proc";
}

export const hostProcAvailable = existsSync(join(PROC, "stat"));

async function read(name: string): Promise<string | null> {
  return readFile(join(PROC, name), "utf8").catch(() => null);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- counter sampling (cpu / net / disk are deltas, not absolutes) ----

type Sample = {
  at: number;
  cpus: number[][]; // index 0 is the aggregate line
  net: Record<string, [number, number]>;
  disk: [number, number]; // sectors read, written
};

const REAL_DISK = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;
const VIRTUAL_NIC = /^(lo|docker|br-|veth|virbr|tun|tap|cni|flannel)/;

let last: Sample | null = null;

async function sample(): Promise<Sample | null> {
  const [stat, net, diskstats] = await Promise.all([
    read("stat"),
    read("net/dev"),
    read("diskstats"),
  ]);
  if (!stat) return null;

  const cpus: number[][] = [];
  for (const line of stat.split("\n")) {
    if (!line.startsWith("cpu")) continue;
    const parts = line.trim().split(/\s+/);
    const values = parts.slice(1).map(Number);
    if (values.length >= 5 && values.every(Number.isFinite)) cpus.push(values);
  }

  const nics: Record<string, [number, number]> = {};
  for (const line of (net || "").split("\n").slice(2)) {
    const [rawName, rest] = line.split(":");
    if (!rest) continue;
    const name = rawName.trim();
    const f = rest.trim().split(/\s+/).map(Number);
    if (f.length < 10) continue;
    nics[name] = [f[0], f[8]];
  }

  let readSectors = 0;
  let writeSectors = 0;
  for (const line of (diskstats || "").split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !REAL_DISK.test(f[2])) continue;
    readSectors += Number(f[5]) || 0;
    writeSectors += Number(f[9]) || 0;
  }

  return { at: Date.now(), cpus, net: nics, disk: [readSectors, writeSectors] };
}

const CPU_MODES = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"];

function diff(prev: Sample, cur: Sample) {
  const seconds = Math.max((cur.at - prev.at) / 1000, 0.001);

  const usage = cur.cpus.map((now, i) => {
    const before = prev.cpus[i] || now.map(() => 0);
    const total = now.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0);
    const idle = now[3] + now[4] - (before[3] + before[4]);
    return total > 0 ? Math.min(100, Math.max(0, ((total - idle) / total) * 100)) : 0;
  });

  const aggBefore = prev.cpus[0] || [];
  const aggNow = cur.cpus[0] || [];
  const aggTotal = aggNow.reduce((a, b) => a + b, 0) - aggBefore.reduce((a, b) => a + b, 0);
  const modes: Record<string, number> = {};
  if (aggTotal > 0) {
    CPU_MODES.forEach((mode, i) => {
      modes[mode] = Math.max(0, ((aggNow[i] || 0) - (aggBefore[i] || 0)) / aggTotal) * 100;
    });
  }

  const interfaces = Object.entries(cur.net)
    .map(([name, [rx, tx]]) => {
      const before = prev.net[name] || [rx, tx];
      return {
        name,
        rxBytes: rx,
        txBytes: tx,
        rxRate: Math.max(0, (rx - before[0]) / seconds),
        txRate: Math.max(0, (tx - before[1]) / seconds),
      };
    })
    .sort((a, b) => b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes));

  const physical = interfaces.filter((n) => !VIRTUAL_NIC.test(n.name));
  const sum = (list: typeof interfaces, key: "rxRate" | "txRate") =>
    list.reduce((acc, n) => acc + n[key], 0);

  return {
    cpu: {
      total: usage[0] ?? 0,
      cores: usage.slice(1),
      modes,
    },
    net: {
      rxRate: sum(physical, "rxRate"),
      txRate: sum(physical, "txRate"),
      interfaces: interfaces.slice(0, 8),
    },
    diskIo: {
      readRate: (Math.max(0, cur.disk[0] - prev.disk[0]) * 512) / seconds,
      writeRate: (Math.max(0, cur.disk[1] - prev.disk[1]) * 512) / seconds,
    },
    windowMs: cur.at - prev.at,
  };
}

// Deltas come from the previous poll; a cold or stale cache pays one short
// in-request window instead of reporting nothing.
async function counters() {
  const now = await sample();
  if (!now) return null;
  const prev = last;
  last = now;
  const age = prev ? now.at - prev.at : Infinity;
  if (prev && age >= 400 && age <= 60_000) return diff(prev, now);
  await sleep(400);
  const second = await sample();
  if (!second) return null;
  last = second;
  return diff(now, second);
}

// ---- point-in-time readings ----

function parseMeminfo(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const [key, value] = line.split(":");
    if (!value) continue;
    out[key.trim()] = (parseInt(value.trim(), 10) || 0) * 1024;
  }
  return out;
}

function parsePressure(text: string | null) {
  if (!text) return null;
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const kind = line.startsWith("full") ? "full" : line.startsWith("some") ? "some" : null;
    if (!kind) continue;
    for (const [, window, value] of line.matchAll(/avg(\d+)=([\d.]+)/g)) {
      out[`${kind}${window}`] = Number(value);
    }
  }
  return Object.keys(out).length ? out : null;
}

export type HostMetrics = Awaited<ReturnType<typeof readHost>>;

export async function readHost() {
  if (!hostProcAvailable) return { available: false as const, procPath: PROC };

  const [counterDelta, meminfoText, loadavg, uptime, hostname, kernel, cpuinfo, psiCpu, psiIo, psiMem, fs] =
    await Promise.all([
      counters(),
      read("meminfo"),
      read("loadavg"),
      read("uptime"),
      read("sys/kernel/hostname"),
      read("sys/kernel/osrelease"),
      read("cpuinfo"),
      read("pressure/cpu"),
      read("pressure/io"),
      read("pressure/memory"),
      statfs(DISK_PATH).catch(() => null),
    ]);

  const mem = meminfoText ? parseMeminfo(meminfoText) : {};
  const load = (loadavg || "").trim().split(/\s+/);
  const procs = (load[3] || "0/0").split("/");
  const memTotal = mem.MemTotal || 0;
  const memAvailable = mem.MemAvailable ?? mem.MemFree ?? 0;
  const swapTotal = mem.SwapTotal || 0;

  return {
    available: true as const,
    procPath: PROC,
    hostname: (hostname || "").trim() || null,
    kernel: (kernel || "").trim() || null,
    cpuModel: cpuinfo?.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() || null,
    cores: counterDelta?.cpu.cores.length || 0,
    uptimeSeconds: Number((uptime || "").split(/\s+/)[0]) || 0,
    cpu: counterDelta?.cpu ?? { total: 0, cores: [], modes: {} },
    net: counterDelta?.net ?? { rxRate: 0, txRate: 0, interfaces: [] },
    diskIo: counterDelta?.diskIo ?? { readRate: 0, writeRate: 0 },
    sampleWindowMs: counterDelta?.windowMs ?? 0,
    memory: {
      total: memTotal,
      available: memAvailable,
      used: Math.max(0, memTotal - memAvailable),
      free: mem.MemFree || 0,
      buffers: mem.Buffers || 0,
      cached: (mem.Cached || 0) + (mem.SReclaimable || 0),
      swapTotal,
      swapUsed: Math.max(0, swapTotal - (mem.SwapFree || 0)),
    },
    load: {
      one: Number(load[0]) || 0,
      five: Number(load[1]) || 0,
      fifteen: Number(load[2]) || 0,
      running: Number(procs[0]) || 0,
      total: Number(procs[1]) || 0,
    },
    pressure: {
      cpu: parsePressure(psiCpu),
      io: parsePressure(psiIo),
      memory: parsePressure(psiMem),
    },
    disk: fs
      ? {
          path: DISK_PATH,
          total: fs.blocks * fs.bsize,
          free: fs.bavail * fs.bsize,
          used: (fs.blocks - fs.bavail) * fs.bsize,
        }
      : null,
  };
}

// Host process lookup, used to spot whatever fronts the app outside Docker.
export async function findHostProcess(
  names: string[],
): Promise<{ pid: number; name: string; cmd: string } | null> {
  if (!hostProcAvailable) return null;
  const entries = await readdir(PROC).catch(() => null);
  if (!entries) return null;
  const wanted = new Set(names);
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const comm = (await readFile(join(PROC, entry, "comm"), "utf8").catch(() => ""))?.trim();
    if (!comm || !wanted.has(comm)) continue;
    const cmdline = await readFile(join(PROC, entry, "cmdline"), "utf8").catch(() => "");
    return {
      pid: Number(entry),
      name: comm,
      cmd: cmdline.split("\0").filter(Boolean).slice(0, 3).join(" ") || comm,
    };
  }
  return null;
}
