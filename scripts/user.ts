import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function usage(): never {
  console.log(`Manage accounts (there is no self sign-up).

  npm run user -- add <username> <password> [--admin]
  npm run user -- passwd <username> <newpassword>
  npm run user -- remove <username>
  npm run user -- list`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const args = argv.slice(1).filter((a) => !a.startsWith("--"));

  switch (cmd) {
    case "add": {
      const [username, password] = args;
      if (!username || !password) usage();
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: { username, passwordHash, isAdmin: flags.has("--admin") },
      });
      console.log(`Created "${username}"${flags.has("--admin") ? " (admin)" : ""}.`);
      break;
    }
    case "passwd": {
      const [username, password] = args;
      if (!username || !password) usage();
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({ where: { username }, data: { passwordHash } });
      console.log(`Password updated for "${username}".`);
      break;
    }
    case "remove": {
      const [username] = args;
      if (!username) usage();
      await prisma.user.delete({ where: { username } });
      console.log(`Removed "${username}".`);
      break;
    }
    case "list": {
      const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
      if (users.length === 0) {
        console.log("(no users yet)");
        break;
      }
      for (const u of users) {
        console.log(
          `#${u.id}  ${u.username}${u.isAdmin ? "  [admin]" : ""}  created ${u.createdAt
            .toISOString()
            .slice(0, 10)}`,
        );
      }
      break;
    }
    default:
      usage();
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
