import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { db, schema } from "./db";
import { safeEqual } from "./crypto";

const COOKIE = "pd_session";
const MAX_AGE = 60 * 60 * 24 * 14;

function sign(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function setSession(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const value = `${userId}.${exp}`;
  (await cookies()).set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, exp, sig] = raw.split(".");
  if (!id || !exp || !sig) return null;
  if (!safeEqual(sig, sign(`${id}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return id;
}

export async function getUser() {
  const id = await getSessionUserId();
  if (!id) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!user) return null;
  // A paid month that has run out is treated as free. Nothing is written; renewing sets a new date.
  if (user.isPro && user.proUntil && user.proUntil.getTime() < Date.now()) return { ...user, isPro: false };
  return user;
}
