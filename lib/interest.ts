import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { PaidPlan } from "./plans";

/** Which paid plans this user has already registered interest in. */
export async function interestedPlans(userId: string): Promise<Set<PaidPlan>> {
  const rows = await db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(and(eq(schema.events.userId, userId), eq(schema.events.type, "interest")));
  return new Set(rows.map((r) => r.payload.plan as PaidPlan));
}
