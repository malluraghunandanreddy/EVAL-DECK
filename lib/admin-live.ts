import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";

const TEST_LOGINS = ["trilens-test-user"];

/** Live counts for the hackathon board (/admin/live). Test accounts are excluded from user numbers. */
export async function liveStats() {
  const now = Date.now();
  const h1 = new Date(now - 3600_000);
  const m10 = new Date(now - 600_000);
  const h3 = new Date(now - 3 * 3600_000);
  const notTest = sql`coalesce(${schema.users.githubLogin}, '') not in ${TEST_LOGINS}`;

  const [total, lastHour, last10, pro, unlockedScans, scansDone, scansActive, recent, buckets, projectsN, dbChecks, payments, watchRuns] = await Promise.all([
    db.select({ n: count() }).from(schema.users).where(notTest),
    db.select({ n: count() }).from(schema.users).where(and(notTest, gte(schema.users.createdAt, h1))),
    db.select({ n: count() }).from(schema.users).where(and(notTest, gte(schema.users.createdAt, m10))),
    db.select({ n: count() }).from(schema.users).where(and(notTest, eq(schema.users.isPro, true))),
    db.select({ n: count() }).from(schema.scans).where(sql`${schema.scans.unlockedAt} is not null`),
    db.select({ n: count() }).from(schema.scans).where(eq(schema.scans.status, "done")),
    db.select({ n: count() }).from(schema.scans).where(inArray(schema.scans.status, ["queued", "running"])),
    db.select({ login: schema.users.githubLogin, email: schema.users.email, createdAt: schema.users.createdAt, isPro: schema.users.isPro })
      .from(schema.users).where(notTest).orderBy(desc(schema.users.createdAt)).limit(15),
    db.select({ bucket: sql<string>`to_char(date_trunc('hour', ${schema.users.createdAt}) + floor(extract(minute from ${schema.users.createdAt}) / 10) * interval '10 min', 'YYYY-MM-DD"T"HH24:MI')`, n: count() })
      .from(schema.users).where(and(notTest, gte(schema.users.createdAt, h3))).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ n: count() }).from(schema.projects),
    db.select({ n: count() }).from(schema.events).where(eq(schema.events.type, "db_check")),
    db.select({ n: count() }).from(schema.events).where(eq(schema.events.type, "payment")),
    db.select({ at: schema.events.createdAt, payload: schema.events.payload }).from(schema.events).where(eq(schema.events.type, "watch_run")).orderBy(desc(schema.events.createdAt)).limit(1),
  ]);

  return {
    at: new Date(now).toISOString(),
    target: 20,
    users: { total: total[0].n, lastHour: lastHour[0].n, last10: last10[0].n, pro: pro[0].n },
    scans: { done: scansDone[0].n, active: scansActive[0].n, unlocked: unlockedScans[0].n },
    projects: projectsN[0].n,
    dbChecks: dbChecks[0].n,
    payments: payments[0].n,
    watch: watchRuns[0] ? { at: watchRuns[0].at.toISOString(), ...(watchRuns[0].payload as Record<string, unknown>) } : null,
    recent: recent.map((u) => ({ who: u.login ? `@${u.login}` : (u.email ?? "email user"), at: u.createdAt.toISOString(), pro: u.isPro })),
    buckets: buckets.map((b) => ({ t: b.bucket, n: b.n })),
  };
}
export type LiveStats = Awaited<ReturnType<typeof liveStats>>;
