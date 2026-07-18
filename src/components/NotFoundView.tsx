import Link from "next/link";
import { BookX } from "lucide-react";

export default function NotFoundView({
  title = "Página não encontrada",
  message = "Este conteúdo não existe ou foi removido.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-elevated">
        <BookX className="h-8 w-8 text-muted" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        <p className="text-sm text-muted">{message}</p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
