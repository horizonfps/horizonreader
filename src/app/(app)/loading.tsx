// Instant route transition fallback for every page in the app group.
export default function AppLoading() {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((s) => (
        <section key={s}>
          <div className="mb-2 h-4 w-32 animate-pulse rounded bg-elevated/70" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-hidden px-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="w-28 shrink-0">
                <div className="aspect-[2/3] animate-pulse rounded-lg bg-elevated" />
                <div className="mt-1.5 h-3 w-5/6 animate-pulse rounded bg-elevated/60" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
