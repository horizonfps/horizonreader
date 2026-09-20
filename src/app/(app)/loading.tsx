// Instant route transition fallback for every page in the app group.
export default function AppLoading() {
  return (
    <div className="space-y-8">
      <div className="-mx-4 flex gap-4 bg-surface/60 px-4 py-6 sm:mx-0 sm:gap-6 sm:rounded-2xl sm:px-8 sm:py-8">
        <div className="aspect-[2/3] w-28 shrink-0 animate-pulse rounded-lg bg-elevated sm:w-40" />
        <div className="flex flex-1 flex-col justify-end gap-3 sm:justify-center">
          <div className="h-7 w-2/3 animate-pulse rounded bg-elevated sm:h-9" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-elevated/70" />
          <div className="hidden h-3 w-5/6 animate-pulse rounded bg-elevated/50 sm:block" />
          <div className="hidden h-3 w-3/4 animate-pulse rounded bg-elevated/50 sm:block" />
        </div>
      </div>
      {[0, 1].map((s) => (
        <section key={s}>
          <div className="mb-3 h-5 w-40 animate-pulse rounded bg-elevated/70" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-hidden px-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="w-28 shrink-0 sm:w-36">
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
