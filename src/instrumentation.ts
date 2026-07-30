// Next.js instrumentation hook: runs once per server process at boot, used
// here to start the background favorites/source refresh loop.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startFavoritesRefresh } = await import("@/lib/backbone/favoritesRefresh");
    startFavoritesRefresh();
  }
}
