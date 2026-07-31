// Process-wide ceiling on source searches in flight against Suwayomi.
//
// Per-work pools cannot bound this: every open work ran its own pool, so a
// handful of concurrent resolves queued hundreds of searches at an engine whose
// GraphQL dispatcher has a fixed worker count. Once those workers were all
// parked on 60s challenge solves, every other query timed out waiting for a
// slot, and the engine looked dead while answering REST in milliseconds.

const LIMIT = Math.max(1, Number(process.env.SUWAYOMI_SEARCH_CONCURRENCY || 8));

type Waiter = { resolve: (granted: boolean) => void; deadline: number; timer: NodeJS.Timeout };

let active = 0;
const waiting: Waiter[] = [];

function pump(): void {
  while (active < LIMIT && waiting.length) {
    const w = waiting.shift()!;
    clearTimeout(w.timer);
    active += 1;
    w.resolve(true);
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

  if (active < LIMIT) {
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

export function engineGateSnapshot(): { active: number; waiting: number; limit: number } {
  return { active, waiting: waiting.length, limit: LIMIT };
}
