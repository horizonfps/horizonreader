"use client";

import { useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";

const COMPACT = "gap-1.5 px-3 py-1.5 text-xs text-muted [&_svg]:h-3.5 [&_svg]:w-3.5";

export default function ShareButton({
  title,
  path,
  size = COMPACT,
}: {
  title: string;
  path: string;
  size?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function share() {
    const url = `${location.origin}${path}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex shrink-0 items-center rounded-lg border border-border bg-surface hover:bg-elevated ${size}`}
    >
      {copied ? <Check className="text-green-400" /> : <Share2 />}
      {copied ? "Link copiado" : "Compartilhar"}
    </button>
  );
}
