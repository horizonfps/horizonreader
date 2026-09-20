"use client";

import { useState } from "react";

const COLLAPSED_CHARS = 420;

export default function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > COLLAPSED_CHARS;
  const shown = open || !long ? text : text.slice(0, COLLAPSED_CHARS).replace(/\s+\S*$/, "") + "…";
  return (
    <div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-text/85">{shown}</p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 text-xs font-medium text-accent hover:text-accent-hover"
        >
          {open ? "Mostrar menos" : "Mostrar mais"}
        </button>
      ) : null}
    </div>
  );
}
