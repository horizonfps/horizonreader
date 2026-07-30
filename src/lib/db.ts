import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  walDone?: boolean;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite default journal mode blocks all readers during a write; WAL lets reads and writes run concurrently.
if (process.env.DATABASE_URL?.startsWith("file:") && !globalForPrisma.walDone) {
  globalForPrisma.walDone = true;
  prisma
    .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
    .then(() => prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL;"))
    .catch(() => {});
}
