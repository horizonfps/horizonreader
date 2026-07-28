import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Infra · HorizonReader" };

export default async function InfoLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isAdmin) redirect("/");

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto max-w-[1500px] px-3 py-3 sm:px-4">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          voltar para a biblioteca
        </Link>
        {children}
      </div>
    </div>
  );
}
