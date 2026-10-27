import { eq } from "drizzle-orm";
import { utils } from "ssh2";
import { db, schema } from "./db";
import { decrypt, encrypt } from "./crypto";
import type { User } from "./db/schema";

/**
 * Each TriLens user gets their own SSH key pair. They add the public key to their server once (hPanel → SSH keys),
 * then the SQLite check only needs the server's IP. The private key is stored encrypted (ENCRYPTION_KEY) and never
 * leaves the server. One key per user, so removing it from a server only cuts off that user's access.
 */
export async function getOrCreateSshKey(user: Pick<User, "id" | "githubLogin" | "email" | "sshPublicKey" | "sshPrivateKeyEnc">): Promise<{ publicKey: string; privateKey: string }> {
  if (user.sshPublicKey && user.sshPrivateKeyEnc) {
    return { publicKey: user.sshPublicKey, privateKey: decrypt(user.sshPrivateKeyEnc) };
  }
  const who = (user.githubLogin ?? user.email ?? user.id.slice(0, 8)).replace(/[^\w.@-]/g, "");
  const pair = utils.generateKeyPairSync("ed25519", { comment: `trilens-check-${who}` });
  await db.update(schema.users)
    .set({ sshPublicKey: pair.public, sshPrivateKeyEnc: encrypt(pair.private) })
    .where(eq(schema.users.id, user.id));
  return { publicKey: pair.public, privateKey: pair.private };
}
