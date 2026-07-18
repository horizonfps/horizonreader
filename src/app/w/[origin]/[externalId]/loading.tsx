import WorkSkeleton from "@/components/WorkSkeleton";

// The bridge route has no app chrome; wrap the skeleton in the same shell.
export default function RefLoading() {
  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto max-w-app px-4 pb-24 pt-3">
        <WorkSkeleton />
      </main>
    </div>
  );
}
