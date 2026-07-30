// Next.js instrumentation hook: runs once per server process at boot, used
// here to start background maintenance loops.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPageWarm } = await import("@/lib/pageWarm");
    startPageWarm();
  }
}
