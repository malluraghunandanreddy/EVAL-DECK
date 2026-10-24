import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { PLAN_NAME, type PaidPlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// GET /admin/interest.csv  (admin only) -> everyone who clicked "I'm interested", for the mailing list
export async function GET() {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const rows = await db.select().from(schema.events).where(eq(schema.events.type, "interest")).orderBy(desc(schema.events.createdAt));
  const lines = ["email,github,plan,when_utc"];
  for (const r of rows) {
    const p = r.payload as { email?: string; login?: string; plan?: PaidPlan };
    lines.push([q(p.email), q(p.login), q(p.plan ? PLAN_NAME[p.plan] : ""), q(r.createdAt.toISOString())].join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="trilens-interest.csv"', "Cache-Control": "no-store" },
  });
}
