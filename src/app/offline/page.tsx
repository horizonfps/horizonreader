export const dynamic = "force-static";

// The service worker answers /offline with its own shelf; this only covers the
// first visit, before the worker is active.
export default function OfflinePage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-black px-6">
      <div className="w-full max-w-sm space-y-2 rounded-2xl bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold">Salvos no aparelho</h1>
        <p className="text-sm text-muted">
          Nada aqui ainda. Recarregue a página depois de abrir o app pelo menos uma vez.
        </p>
      </div>
    </div>
  );
}
