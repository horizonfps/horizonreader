// Read-only Docker Engine client. It never touches /var/run/docker.sock: the
// compose file puts a socket proxy in front that whitelists GET endpoints, so a
// compromise of this app cannot drive the daemon.

const BASE = (process.env.DOCKER_API_URL || "http://dockerproxy:2375").replace(/\/+$/, "");

export const dockerConfigured = Boolean(process.env.DOCKER_API_URL || process.env.NODE_ENV === "production");

async function api<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`docker ${res.status} ${path}`);
  return (await res.json()) as T;
}

export type DockerInfo = {
  Name: string;
  ServerVersion: string;
  NCPU: number;
  MemTotal: number;
  OperatingSystem: string;
  KernelVersion: string;
  Architecture: string;
  ContainersRunning: number;
  ContainersStopped: number;
  ContainersPaused: number;
  Images: number;
  Driver: string;
};

type RawContainer = {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
};

type RawInspect = {
  Name: string;
  Created: string;
  RestartCount: number;
  State: {
    Status: string;
    Running: boolean;
    StartedAt: string;
    FinishedAt: string;
    ExitCode: number;
    OOMKilled: boolean;
    Error: string;
    Health?: { Status: string; FailingStreak: number };
  };
  HostConfig: { Memory: number; RestartPolicy?: { Name: string } };
  Config: { Image: string };
};

type RawStats = {
  cpu_stats: CpuStats;
  precpu_stats: CpuStats;
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { op: string; value: number }[] | null };
  pids_stats?: { current?: number };
};

type CpuStats = {
  cpu_usage: { total_usage: number; percpu_usage?: number[] };
  system_cpu_usage?: number;
  online_cpus?: number;
};

export type ContainerMetrics = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
  healthFailingStreak: number;
  restartCount: number;
  restartPolicy: string | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  exitCode: number | null;
  oomKilled: boolean;
  error: string | null;
  cpuPercent: number | null;
  memUsed: number | null;
  memLimit: number | null;
  memPercent: number | null;
  netRx: number | null;
  netTx: number | null;
  blockRead: number | null;
  blockWrite: number | null;
  pids: number | null;
};

export async function dockerInfo(): Promise<DockerInfo> {
  return api<DockerInfo>("/info");
}

function cpuPercent(s: RawStats): number | null {
  const cur = s.cpu_stats;
  const prev = s.precpu_stats;
  if (!cur?.system_cpu_usage || !prev?.system_cpu_usage) return null;
  const cpuDelta = cur.cpu_usage.total_usage - prev.cpu_usage.total_usage;
  const sysDelta = cur.system_cpu_usage - prev.system_cpu_usage;
  if (sysDelta <= 0 || cpuDelta < 0) return null;
  const cores = cur.online_cpus || cur.cpu_usage.percpu_usage?.length || 1;
  return Math.max(0, (cpuDelta / sysDelta) * cores * 100);
}

function memUsed(s: RawStats): number | null {
  const usage = s.memory_stats?.usage;
  if (usage == null) return null;
  const inactive = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.total_inactive_file ?? 0;
  return Math.max(0, usage - inactive);
}

function blockIo(s: RawStats): [number, number] {
  let read = 0;
  let write = 0;
  for (const entry of s.blkio_stats?.io_service_bytes_recursive || []) {
    const op = entry.op?.toLowerCase();
    if (op === "read") read += entry.value;
    else if (op === "write") write += entry.value;
  }
  return [read, write];
}

// stream=false makes the daemon collect two samples before answering, which is
// what fills precpu_stats and lets the CPU delta be real.
async function statsOf(id: string): Promise<RawStats | null> {
  return api<RawStats>(`/containers/${id}/stats?stream=false`, 15_000).catch(() => null);
}

export async function listContainerMetrics(): Promise<ContainerMetrics[]> {
  const list = await api<RawContainer[]>("/containers/json?all=true");
  const now = Date.now();

  const rows = await Promise.all(
    list.map(async (c) => {
      const [detail, stats] = await Promise.all([
        api<RawInspect>(`/containers/${c.Id}/json`).catch(() => null),
        c.State === "running" ? statsOf(c.Id) : Promise.resolve(null),
      ]);

      const startedAt = detail?.State.StartedAt ?? null;
      const started = startedAt ? Date.parse(startedAt) : NaN;
      const [blockRead, blockWrite] = stats ? blockIo(stats) : [null, null];
      const netTotals = Object.values(stats?.networks || {}).reduce(
        (acc, n) => [acc[0] + n.rx_bytes, acc[1] + n.tx_bytes],
        [0, 0],
      );
      const used = stats ? memUsed(stats) : null;
      const limit = stats?.memory_stats?.limit ?? null;

      return {
        id: c.Id.slice(0, 12),
        name: (c.Names[0] || c.Id).replace(/^\//, ""),
        image: c.Image,
        state: c.State,
        status: c.Status,
        health: detail?.State.Health?.Status ?? null,
        healthFailingStreak: detail?.State.Health?.FailingStreak ?? 0,
        restartCount: detail?.RestartCount ?? 0,
        restartPolicy: detail?.HostConfig.RestartPolicy?.Name ?? null,
        startedAt,
        uptimeSeconds: Number.isFinite(started) && c.State === "running" ? (now - started) / 1000 : null,
        exitCode: detail?.State.ExitCode ?? null,
        oomKilled: detail?.State.OOMKilled ?? false,
        error: detail?.State.Error || null,
        cpuPercent: stats ? cpuPercent(stats) : null,
        memUsed: used,
        memLimit: limit,
        memPercent: used != null && limit ? (used / limit) * 100 : null,
        netRx: stats ? netTotals[0] : null,
        netTx: stats ? netTotals[1] : null,
        blockRead,
        blockWrite,
        pids: stats?.pids_stats?.current ?? null,
      } satisfies ContainerMetrics;
    }),
  );

  return rows.sort((a, b) => {
    if (a.state !== b.state) return a.state === "running" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function listContainerNames(): Promise<{ id: string; name: string; state: string }[]> {
  const list = await api<RawContainer[]>("/containers/json?all=true");
  return list.map((c) => ({
    id: c.Id,
    name: (c.Names[0] || c.Id).replace(/^\//, ""),
    state: c.State,
  }));
}

// Docker frames non-TTY logs as [stream, 0,0,0, size:u32be] + payload.
function demux(buf: Buffer): { stream: "stdout" | "stderr"; text: string }[] {
  const out: { stream: "stdout" | "stderr"; text: string }[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const type = buf[offset];
    if ((type !== 1 && type !== 2) || buf[offset + 1] !== 0 || buf[offset + 2] !== 0 || buf[offset + 3] !== 0) {
      // TTY container: the whole body is already plain text.
      return [{ stream: "stdout", text: buf.subarray(offset).toString("utf8") }];
    }
    const size = buf.readUInt32BE(offset + 4);
    out.push({
      stream: type === 2 ? "stderr" : "stdout",
      text: buf.subarray(offset + 8, offset + 8 + size).toString("utf8"),
    });
    offset += 8 + size;
  }
  return out;
}

export async function containerLogs(id: string, tail: number): Promise<{ stream: "stdout" | "stderr"; text: string }[]> {
  const res = await fetch(
    `${BASE}/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`,
    { cache: "no-store", signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new Error(`docker logs ${res.status}`);
  return demux(Buffer.from(await res.arrayBuffer()));
}
