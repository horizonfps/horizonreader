// Route-level skeleton mirroring the work page layout.
export default function WorkSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex gap-4">
        <div className="aspect-[2/3] w-28 shrink-0 animate-pulse rounded-lg bg-elevated sm:w-40" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <div className="h-5 w-3/4 animate-pulse rounded bg-elevated" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-elevated/70" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-elevated/60" />
          <div className="flex gap-2 pt-2">
            <div className="h-8 w-28 animate-pulse rounded-lg bg-elevated" />
          </div>
        </div>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-6 w-16 animate-pulse rounded-full bg-elevated/60" />
        ))}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-elevated/50" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-elevated/50" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-elevated/50" />
      </div>
      <section>
        <h2 className="mb-2 text-sm text-muted">Fontes</h2>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-7 w-24 animate-pulse rounded-full bg-elevated" />
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm text-muted">Capítulos</h2>
        <div className="mb-3 h-10 w-full animate-pulse rounded-lg bg-elevated" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded bg-elevated/60" />
          ))}
        </div>
      </section>
    </div>
  );
}
