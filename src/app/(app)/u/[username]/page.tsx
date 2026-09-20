import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import ProfileView from "@/components/ProfileView";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

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

  const [favorites, history, chaptersRead] = await Promise.all([
    prisma.favorite
      .findMany({ where: { userId: user.id }, include: { work: true }, orderBy: { updatedAt: "desc" } })
      .catch(() => []),
    prisma.readingHistory
      .findMany({
        where: { userId: user.id },
        include: { work: true },
        orderBy: { readAt: "desc" },
        take: 40,
      })
      .catch(() => []),
    prisma.progress.count({ where: { userId: user.id, read: true } }).catch(() => 0),
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
        createdAt: user.createdAt,
      }}
      favorites={favorites}
      history={history}
      stats={{ chaptersRead }}
    />
  );
}
