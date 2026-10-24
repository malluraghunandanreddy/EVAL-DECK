import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, logEvent } from "@/lib/db";
import { getUser } from "@/lib/session";
import { PAID_PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

const Body = z.object({
  plan: z.enum(PAID_PLANS as [string, ...string[]]),
  scanId: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});

// POST /api/interest  { plan: "single" | "monthly", scanId?, email? }
// Signed-in free users tell us they want a paid plan. Stored as an `interest` event so the
// admin page can list them and export their emails. Safe to call twice: the second call is a no-op.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let email = user.email;
  if (!email && body.email) {
    await db.update(schema.users).set({ email: body.email }).where(eq(schema.users.id, user.id));
    email = body.email;
  }
  if (!email) return NextResponse.json({ error: "Add an email so we can reach you", needsEmail: true }, { status: 422 });

  const [existing] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.userId, user.id), eq(schema.events.type, "interest"), sql`${schema.events.payload}->>'plan' = ${body.plan}`))
    .limit(1);
  if (existing) return NextResponse.json({ ok: true, already: true });

  await logEvent("interest", user.id, { plan: body.plan, email, login: user.githubLogin, scanId: body.scanId ?? null });
  return NextResponse.json({ ok: true });
}
