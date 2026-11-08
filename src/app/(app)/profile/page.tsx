import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import ExportButton from "@/components/ExportButton";
import ShareButton from "@/components/ShareButton";
import ProfileEditForm from "@/components/ProfileEditForm";
import ProfileView from "@/components/ProfileView";
import { profileGameStats } from "@/lib/readerStats";

export const dynamic = "force-dynamic";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) return null;

  const [user, favorites, history, game] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.uid }, include: { invite: { select: { createdBy: { select: { username: true, displayName: true } } } } } }).catch(() => null),
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
    profileGameStats(session.uid).catch(() => null),
  ]);

  const profileUser = {
    username: user?.username ?? session.username,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    bannerUrl: user?.bannerUrl ?? null,
    bio: user?.bio ?? null,
    isAdmin: user?.isAdmin ?? session.isAdmin,
    createdAt: user?.createdAt ?? null,
    invitedBy: user?.invite?.createdBy ?? null,
  };

  return (
    <ProfileView
      user={profileUser}
      favorites={favorites}
      history={history}
      game={game}
      actions={
        <>
          <ShareButton
            title={profileUser.displayName || profileUser.username}
            path={`/u/${encodeURIComponent(profileUser.username)}`}
            size="gap-2 px-3 py-2 text-sm text-text [&_svg]:h-4 [&_svg]:w-4"
          />
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
