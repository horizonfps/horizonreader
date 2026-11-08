import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { MAX_PENDING_INVITES } from "@/lib/invites";
import InviteManager, { type InviteRow } from "@/components/InviteManager";

export const dynamic = "force-dynamic";

export const metadata = { title: "Convites" };

export default async function InvitesPage() {
  const session = await getSession();
  if (!session) return null;

  const rows = await prisma.invite
    .findMany({
      where: { createdById: session.uid },
      include: { usedBy: { select: { username: true, displayName: true, isAdmin: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    .catch(() => []);

  const invites: InviteRow[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    usedAt: r.usedAt?.toISOString() ?? null,
    usedBy: r.usedBy,
  }));

  return (
    <InviteManager
      initial={invites}
      limit={session.isAdmin ? null : MAX_PENDING_INVITES}
      now={Date.now()}
    />
  );
}
