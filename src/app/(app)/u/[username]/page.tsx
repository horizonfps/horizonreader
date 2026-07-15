import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import ProfileView from "@/components/ProfileView";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  // Next already decodes the dynamic route param; do not decode again.
  const { username } = await params;

  const user = await prisma.user.findUnique({ where: { username } }).catch(() => null);
  if (!user) notFound();

  const [favorites, history] = await Promise.all([
    prisma.favorite
      .findMany({ where: { userId: user.id }, include: { work: true } })
      .catch(() => []),
    prisma.readingHistory
      .findMany({
        where: { userId: user.id },
        include: { work: true },
        orderBy: { readAt: "desc" },
        take: 20,
      })
      .catch(() => []),
  ]);

  return (
    <ProfileView
      user={{
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bannerUrl: user.bannerUrl,
        bio: user.bio,
        isAdmin: user.isAdmin,
      }}
      favorites={favorites}
      history={history}
    />
  );
}
