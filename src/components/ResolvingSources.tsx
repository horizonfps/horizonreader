"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 3_500;
const MAX_TRIES = 6;

// Sources resolve in the background on first open; poll the route until they
// land so chapters appear on their own instead of a blank waiting screen.
export default function ResolvingSources() {
  const router = useRouter();
  const tries = useRef(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (gaveUp) return;
    const id = setInterval(() => {
      tries.current += 1;
      if (tries.current > MAX_TRIES) {
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [router, gaveUp]);

  if (gaveUp) {
    return (
      <p className="text-sm text-muted">
        Nenhuma fonte encontrada ainda. Toque em Atualizar fontes para procurar.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2.5 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      Procurando fontes…
    </div>
  );
}
