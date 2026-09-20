// Route-level skeleton mirroring the work page layout.
export default function WorkSkeleton() {
  return (
    <div className="pt-4 sm:pt-8 lg:pt-12">
      <header className="flex gap-4 sm:gap-6 lg:gap-8">
        <div className="aspect-[2/3] w-28 shrink-0 animate-pulse rounded-lg bg-elevated sm:w-44 lg:w-56" />
        <div className="flex min-w-0 flex-1 flex-col justify-end space-y-2">
          <div className="h-8 w-3/4 animate-pulse rounded bg-elevated sm:h-10" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-elevated/70" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-elevated/60" />
          <div className="hidden gap-2 pt-2 sm:flex">
            <div className="h-9 w-36 animate-pulse rounded-lg bg-elevated" />
            <div className="h-9 w-32 animate-pulse rounded-lg bg-elevated" />
          </div>
        </div>
      </header>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-5 w-16 animate-pulse rounded-md bg-elevated/60" />
        ))}
      </div>
      <div className="mt-6 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        <div className="hidden space-y-2 lg:block">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-elevated/50" />
          ))}
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-elevated/50" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-elevated/50" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-elevated/50" />
          </div>
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="h-9 w-56 animate-pulse rounded-lg bg-elevated" />
              <div className="ml-auto h-9 w-40 animate-pulse rounded-lg bg-elevated" />
            </div>
            <div className="h-10 w-48 animate-pulse rounded-lg bg-elevated" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-11 w-full animate-pulse rounded-lg bg-elevated/60" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
