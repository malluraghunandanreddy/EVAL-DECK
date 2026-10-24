import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Supabase pooled connection (port 6543, transaction mode) does not support prepared statements.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client =
  globalForDb.pg ??
  postgres(process.env.DATABASE_URL ?? "postgres://localhost:5432/policydrift", {
    // Supabase free-tier pooler: 15 server connections shared by every Vercel instance. Keep 2 per
    // instance, drop idle ones after 20 s; extra queries queue inside postgres-js.
    prepare: false, max: 2, idle_timeout: 5, max_lifetime: 300, connect_timeout: 10,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };

export async function logEvent(type: string, userId: string | null, payload: Record<string, unknown> = {}) {
  try {
    await db.insert(schema.events).values({ type, userId, payload });
  } catch (err) {
    console.error("event log failed", type, (err as Error).message);
  }
}
