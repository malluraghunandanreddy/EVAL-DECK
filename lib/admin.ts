import { cookies } from "next/headers";
import { hmacHex, safeEqual } from "./crypto";

export const ADMIN_COOKIE = "pd_admin";
export const ADMIN_MAX_AGE = 60 * 60 * 8;

export function adminSig(exp: string): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  // Key = admin password + session secret, so rotating either logs the admin out.
  return hmacHex(`${pw}:${process.env.SESSION_SECRET ?? ""}`, `admin.${exp}`);
}

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  const expected = exp ? adminSig(exp) : null;
  if (!exp || !sig || !expected || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, expected);
}
