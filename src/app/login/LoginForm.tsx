"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next") || "/";

  // Only allow same-origin local paths (blocks open redirect via ?next=//evil).
  function safeNext(raw: string): string {
    try {
      const u = new URL(raw, window.location.origin);
      if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
    } catch {
      /* ignore */
    }
    return "/";
  }

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError("Usuário ou senha inválidos.");
        setLoading(false);
        return;
      }
      router.replace(safeNext(nextParam));
      router.refresh();
    } catch {
      setError("Falha de conexão.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        placeholder="usuário"
        autoCapitalize="none"
        autoCorrect="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        type="password"
        placeholder="senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-lg bg-accent py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
