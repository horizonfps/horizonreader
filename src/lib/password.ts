import bcrypt from "bcryptjs";

// Fixed decoy hash so a missing user still costs a full bcrypt compare,
// removing the timing channel that would otherwise leak valid usernames.
const DUMMY_HASH = bcrypt.hashSync("mr-nonexistent-user-placeholder", 10);

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function verifyPasswordConstantTime(plain: string, hash: string | null) {
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return hash ? ok : false;
}
