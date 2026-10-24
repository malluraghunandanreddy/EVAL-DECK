import { eq, asc } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { db, schema } from "../lib/db";
async function main() {
  if (process.argv[2] === "reset") {
    await db.update(schema.users).set({ isPro: false, proUntil: null }).where(eq(schema.users.githubLogin, "trilens-test-user"));
    console.log("test user reset"); process.exit(0);
  }
  const users = await db.select({ id: schema.users.id, login: schema.users.githubLogin, email: schema.users.email, createdAt: schema.users.createdAt, isPro: schema.users.isPro }).from(schema.users).orderBy(asc(schema.users.createdAt));
  const events = await db.select().from(schema.events).orderBy(asc(schema.events.createdAt));
  const name = new Map(users.map((u) => [u.id, u.login ?? u.email ?? u.id.slice(0, 8)]));
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().replace("T", " ").slice(0, 19) + " IST";
  const lines = ["timestamp_ist,event,user,details"];
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    const details = Object.entries(p).filter(([k]) => !/token|hash|secret|url/i.test(k)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; ").replace(/"/g, "'").slice(0, 160);
    lines.push(`${ist(e.createdAt)},${e.type},${e.userId ? name.get(e.userId) ?? e.userId.slice(0, 8) : "-"},"${details}"`);
  }
  const out = "/private/tmp/claude-502/-Users-sai-mallela-Code-EVAL-DECK/920f2c04-06ad-44ce-87d3-08e327208794/scratchpad/trilens-usage-log.csv";
  writeFileSync(out, lines.join("\n") + "\n");
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  console.log(JSON.stringify({ users: users.length, firstUser: users[0] ? ist(users[0].createdAt) : null, events: events.length, byType: counts, logins: users.map((u) => u.login ?? u.email) }));
  process.exit(0);
}
main();
