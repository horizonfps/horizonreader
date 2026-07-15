import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import ExportButton from "@/components/ExportButton";
import ProfileEditForm from "@/components/ProfileEditForm";
import ProfileView from "@/components/ProfileView";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) return null;

  const [user, favorites, history] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.uid } }).catch(() => null),
    prisma.favorite
      .findMany({ where: { userId: session.uid }, include: { work: true } })
      .catch(() => []),
    prisma.readingHistory
      .findMany({
        where: { userId: session.uid },
        include: { work: true },
        orderBy: { readAt: "desc" },
        take: 20,
      })
      .catch(() => []),
  ]);

  const profileUser = {
    username: user?.username ?? session.username,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    bannerUrl: user?.bannerUrl ?? null,
    bio: user?.bio ?? null,
    isAdmin: user?.isAdmin ?? session.isAdmin,
  };

  return (
    <ProfileView
      user={profileUser}
      favorites={favorites}
      history={history}
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
