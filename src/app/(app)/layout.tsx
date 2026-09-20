import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import OfflineSync from "@/components/OfflineSync";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user
    .findUnique({
      where: { id: session.uid },
      select: { username: true, displayName: true, avatarUrl: true, isAdmin: true },
    })
    .catch(() => undefined);
  // null means the account was removed while its token was still valid.
  if (user === null) redirect("/api/auth/logout");

  const topUser = {
    username: user?.username ?? session.username,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    isAdmin: user?.isAdmin ?? session.isAdmin,
  };

  return (
    <div className="min-h-dvh bg-bg">
      <Sidebar isAdmin={topUser.isAdmin} />
      <TopBar user={topUser} />
      <div className="lg:pl-60">
        <main className="mx-auto max-w-app px-4 pb-24 pt-4 lg:pb-10">{children}</main>
      </div>
      <BottomNav />
      <OfflineSync />
    </div>
  );
}
