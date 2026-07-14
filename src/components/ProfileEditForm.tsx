"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, ImagePlus, User as UserIcon, Loader2 } from "lucide-react";
import { coverProxy } from "@/lib/cards";

type ProfileFields = {
  displayName?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
};

const inputClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent";

async function uploadImage(file: File, kind: "avatar" | "banner"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  const res = await fetch("/api/profile/upload", { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || "upload failed");
  return data.url;
}

export default function ProfileEditForm({ initial }: { initial: ProfileFields }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(initial.bannerUrl ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");

  const [uploading, setUploading] = useState<null | "avatar" | "banner">(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  async function onPick(kind: "avatar" | "banner", e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setUploading(kind);
    try {
      const url = await uploadImage(file, kind);
      if (kind === "avatar") setAvatarUrl(url);
      else setBannerUrl(url);
    } catch {
      setError("Não foi possível enviar a imagem.");
    } finally {
      setUploading(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, avatarUrl, bannerUrl, bio }),
      });
      if (!res.ok) {
        setError("Não foi possível salvar.");
        setSaving(false);
        return;
      }
      setOpen(false);
      setSaving(false);
      router.refresh();
    } catch {
      setError("Falha de conexão.");
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-elevated"
      >
        <Pencil className="h-4 w-4" />
        Editar perfil
      </button>
    );
  }

  const bannerPreview = coverProxy(bannerUrl);
  const avatarPreview = coverProxy(avatarUrl);

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">Editar perfil</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-muted hover:bg-elevated hover:text-text"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={bannerInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick("banner", e)}
      />
      <input
        ref={avatarInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick("avatar", e)}
      />

      <span className="text-xs text-muted">Banner</span>
      <button
        type="button"
        onClick={() => bannerInput.current?.click()}
        className="relative h-28 w-full overflow-hidden rounded-xl border border-border bg-elevated bg-cover bg-center"
        style={bannerPreview ? { backgroundImage: `url("${bannerPreview}")` } : undefined}
      >
        <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30 text-xs text-white">
          {uploading === "banner" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          {uploading === "banner" ? "Enviando…" : "Escolher arquivo"}
        </span>
      </button>

      <span className="text-xs text-muted">Avatar</span>
      <button
        type="button"
        onClick={() => avatarInput.current?.click()}
        className="relative h-20 w-20 overflow-hidden rounded-full border border-border bg-elevated"
      >
        {avatarPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted">
            <UserIcon className="h-7 w-7" />
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          {uploading === "avatar" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
        </span>
      </button>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Nome de exibição
        <input
          className={inputClass}
          value={displayName}
          maxLength={500}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Bio
        <textarea
          className={`${inputClass} min-h-20 resize-y`}
          value={bio}
          maxLength={500}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || uploading !== null}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text hover:bg-elevated"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
