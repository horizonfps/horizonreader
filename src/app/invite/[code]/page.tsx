import Link from "next/link";
import { User as UserIcon } from "lucide-react";
import { coverProxy } from "@/lib/cards";
import { findUsableInvite } from "@/lib/invites";
import Username from "@/components/Username";
import SignupForm from "./SignupForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await findUsableInvite(code).catch(() => null);
  const inviter = invite?.createdBy;
  const avatar = inviter ? coverProxy(inviter.avatarUrl) : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-xs">
        <div className="mx-auto h-20 w-20 overflow-hidden rounded-full border border-border bg-surface">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/icon.png" alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <h1 className="mt-5 text-center text-lg font-semibold tracking-tight">HorizonReader</h1>
        {inviter ? (
          <>
            <p className="mt-1 text-center text-sm text-muted">
              Convite de{" "}
              <Username name={inviter.displayName || inviter.username} isAdmin={inviter.isAdmin} className="text-text" />
            </p>
            <div className="mt-6">
              <SignupForm code={code} />
            </div>
          </>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-4 text-center">
            <p className="flex items-center gap-2 text-sm text-muted">
              <UserIcon className="h-4 w-4" />
              Convite inválido, usado ou expirado.
            </p>
            <Link href="/login" className="text-sm text-accent hover:underline">
              Entrar
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
