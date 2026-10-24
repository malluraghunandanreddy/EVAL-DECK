import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, logEvent, schema } from "./db";
import type { Scan, User } from "./db/schema";
import { safeEqual } from "./crypto";
import { PLAN_PRICES, proForAll } from "./plans";

export type Plan = "free" | "single" | "monthly";
export const MONTHLY_DAYS = 30;

/** Pro monthly is active: PRO_FOR_ALL, or is_pro with no expiry or an expiry in the future. */
export function isMonthly(user: Pick<User, "isPro" | "proUntil">): boolean {
  if (proForAll()) return true;
  return user.isPro && (!user.proUntil || user.proUntil.getTime() > Date.now());
}

/** Fixes, full policy and the database check are available for this scan (bought once, or Pro monthly). */
export function scanUnlocked(user: Pick<User, "isPro" | "proUntil">, scan: Pick<Scan, "unlockedAt">): boolean {
  return isMonthly(user) || !!scan.unlockedAt;
}

export function planFor(user: Pick<User, "isPro" | "proUntil">, scan: Pick<Scan, "unlockedAt">): Plan {
  if (isMonthly(user)) return "monthly";
  if (scan.unlockedAt) return "single";
  return "free";
}

/**
 * Dummy checkout until Pine Labs goes live: the transaction reference must equal PAYMENT_MASTER_CODE.
 * Never log or store the raw value; events keep a hash so the admin page can count manual payments.
 */
export function transactionAccepted(txn: string): boolean {
  const master = (process.env.PAYMENT_MASTER_CODE ?? "").trim();
  const given = txn.trim();
  return !!master && !!given && safeEqual(given, master);
}

const txnHash = (txn: string) => createHash("sha256").update(`policydrift-txn:${txn.trim()}`).digest("hex");
const manualRef = () => `manual_${Date.now()}_${randomBytes(4).toString("hex")}`;

/** Unlock one report. Idempotent: a second purchase of the same scan just returns. */
export async function grantSingle(userId: string, scan: Pick<Scan, "id" | "unlockedAt">, txn: string): Promise<void> {
  if (scan.unlockedAt) return;
  await db.insert(schema.orders).values({ userId, merchantOrderRef: manualRef(), amountPaise: PLAN_PRICES.single.rupees * 100, status: "paid" });
  await db.update(schema.scans).set({ unlockedAt: new Date() }).where(eq(schema.scans.id, scan.id));
  await logEvent("payment", userId, { method: "manual", plan: "single", scanId: scan.id, txn_hash: txnHash(txn) });
}

/** Start (or extend) a Pro month from now. */
export async function grantMonthly(userId: string, txn: string): Promise<void> {
  await db.insert(schema.orders).values({ userId, merchantOrderRef: manualRef(), amountPaise: PLAN_PRICES.monthly.rupees * 100, status: "paid" });
  await db.update(schema.users)
    .set({ isPro: true, proUntil: new Date(Date.now() + MONTHLY_DAYS * 86_400_000) })
    .where(eq(schema.users.id, userId));
  await logEvent("payment", userId, { method: "manual", plan: "monthly", txn_hash: txnHash(txn) });
}
