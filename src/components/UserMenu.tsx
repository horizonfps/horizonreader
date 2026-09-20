"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User as UserIcon, LogOut, Activity, Download, History, Shuffle } from "lucide-react";
import { coverProxy } from "@/lib/cards";
import Username from "@/components/Username";

export default function UserMenu({
  username,
  displayName,
  avatarUrl,
  isAdmin,
}: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const src = coverProxy(avatarUrl);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function logout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  const item =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text hover:bg-elevated";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conta"
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-elevated text-muted transition-colors hover:border-accent"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserIcon className="h-4 w-4" />
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl shadow-black/60"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium">
              <Username name={displayName || username} isAdmin={isAdmin} />
            </p>
            <p className="truncate text-xs text-muted">@{username}</p>
          </div>
          <Link href="/profile" role="menuitem" onClick={() => setOpen(false)} className={item}>
            <UserIcon className="h-4 w-4 text-muted" />
            Perfil
          </Link>
          <Link href="/history" role="menuitem" onClick={() => setOpen(false)} className={item}>
            <History className="h-4 w-4 text-muted" />
            Histórico
          </Link>
          <Link href="/downloads" role="menuitem" onClick={() => setOpen(false)} className={item}>
            <Download className="h-4 w-4 text-muted" />
            Downloads
          </Link>
          <a href="/random" role="menuitem" onClick={() => setOpen(false)} className={item}>
            <Shuffle className="h-4 w-4 text-muted" />
            Obra aleatória
          </a>
          {isAdmin ? (
            <Link href="/info" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Activity className="h-4 w-4 text-muted" />
              Infra
            </Link>
          ) : null}
          <div className="my-1 border-t border-border" />
          <button type="button" role="menuitem" onClick={logout} className={item}>
            <LogOut className="h-4 w-4 text-muted" />
            Sair
          </button>
        </div>
      ) : null}
    </div>
  );
}
