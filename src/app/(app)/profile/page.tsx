import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import ExportButton from "@/components/ExportButton";
import ProfileEditForm from "@/components/ProfileEditForm";
import ProfileView from "@/components/ProfileView";

export const dynamic = "force-dynamic";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) return null;

  const [user, favorites, history, chaptersRead] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.uid } }).catch(() => null),
    prisma.favorite
      .findMany({ where: { userId: session.uid }, include: { work: true }, orderBy: { updatedAt: "desc" } })
      .catch(() => []),
    prisma.readingHistory
      .findMany({
        where: { userId: session.uid },
        include: { work: true },
        orderBy: { readAt: "desc" },
        take: 40,
      })
      .catch(() => []),
    prisma.progress.count({ where: { userId: session.uid, read: true } }).catch(() => 0),
  ]);

  const profileUser = {
    username: user?.username ?? session.username,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    bannerUrl: user?.bannerUrl ?? null,
    bio: user?.bio ?? null,
    isAdmin: user?.isAdmin ?? session.isAdmin,
    createdAt: user?.createdAt ?? null,
  };

  return (
    <ProfileView
      user={profileUser}
      favorites={favorites}
      history={history}
      stats={{ chaptersRead }}
      actions={
        <>
          <ExportButton />
          <ProfileEditForm
            initial={{
              displayName: user?.displayName ?? null,
              avatarUrl: user?.avatarUrl ?? null,
              bannerUrl: user?.bannerUrl ?? null,
              bio: user?.bio ?? null,
            }}
          />
        </>
      }
    />
  );
}
