"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ERRORS: Record<string, string> = {
  bad_username: "Usuário: 3 a 20 caracteres entre letras, números, _ e .",
  bad_password: "A senha precisa de pelo menos 6 caracteres.",
  username_taken: "Esse usuário já existe.",
  invalid_invite: "Convite inválido, usado ou expirado.",
  too_many_attempts: "Muitas tentativas. Tente de novo mais tarde.",
};

const input =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent";

export default function SignupForm({ code }: { code: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(ERRORS[data?.error] ?? "Não foi possível criar a conta.");
        setLoading(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Falha de conexão.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input
        className={input}
        placeholder="usuário"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
        maxLength={20}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className={input}
        type="password"
        placeholder="senha"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className={input}
        type="password"
        placeholder="repetir senha"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading || !username || !password}
        className="mt-1 rounded-lg bg-accent py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? "Criando…" : "Criar conta"}
      </button>
    </form>
  );
}
