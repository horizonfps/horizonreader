// Process-wide ceiling on source searches in flight against Suwayomi.
//
// Per-work pools cannot bound this: every open work ran its own pool, so a
// handful of concurrent resolves queued hundreds of searches at an engine whose
// GraphQL dispatcher has a fixed worker count. Once those workers were all
// parked on 60s challenge solves, every other query timed out waiting for a
// slot, and the engine looked dead while answering REST in milliseconds.

const LIMIT = Math.max(1, Number(process.env.SUWAYOMI_SEARCH_CONCURRENCY || 8));

// While a reader is waiting on screen the sweep gets squeezed down to this, so
// its searches stop taking every engine worker ahead of the read.
const FOREGROUND_LIMIT = Math.max(1, Math.floor(LIMIT / 4));
const LEASE_MAX_MS = 60_000;

type Waiter = { resolve: (granted: boolean) => void; deadline: number; timer: NodeJS.Timeout };

let active = 0;
let foreground = 0;
const waiting: Waiter[] = [];

function effectiveLimit(): number {
  return foreground > 0 ? FOREGROUND_LIMIT : LIMIT;
}

function pump(): void {
  while (active < effectiveLimit() && waiting.length) {
    const w = waiting.shift()!;
    clearTimeout(w.timer);
    active += 1;
    w.resolve(true);
  }
}

// Marks a user-facing engine read as in flight. Holders of a slot are never
// interrupted; the squeeze only stops new grants.
export async function withForegroundRead<T>(fn: () => Promise<T>): Promise<T> {
  foreground += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    foreground -= 1;
    pump();
  };
  const timer = setTimeout(release, LEASE_MAX_MS);
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    release();
  }
}

export type EngineSlot = { release: () => void };

// Resolves null when the deadline passes before a slot frees up, so the caller
// drops the source instead of piling onto the queue.
export function acquireEngineSlot(deadline: number): Promise<EngineSlot | null> {
  const grant = (): EngineSlot => {
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        active -= 1;
        pump();
      },
    };
  };

  if (active < effectiveLimit()) {
    active += 1;
    return Promise.resolve(grant());
  }

  const wait = deadline - Date.now();
  if (wait <= 0) return Promise.resolve(null);

  return new Promise<EngineSlot | null>((resolve) => {
    const w: Waiter = {
      deadline,
      resolve: (granted) => resolve(granted ? grant() : null),
      timer: setTimeout(() => {
        const i = waiting.indexOf(w);
        if (i >= 0) waiting.splice(i, 1);
        resolve(null);
      }, wait),
    };
    waiting.push(w);
  });
}

export function engineGateSnapshot(): {
  active: number;
  waiting: number;
  limit: number;
  foreground: number;
  effectiveLimit: number;
} {
  return {
    active,
    waiting: waiting.length,
    limit: LIMIT,
    foreground,
    effectiveLimit: effectiveLimit(),
  };
}
