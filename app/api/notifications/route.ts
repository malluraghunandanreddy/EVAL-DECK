import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/notifications -> latest 20 for the signed-in user, unread first
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(20);
  return NextResponse.json({ unread: rows.filter((r) => !r.readAt).length, notifications: rows }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/notifications { id? } -> mark one (or all) read
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let id: string | undefined;
  try { id = ((await req.json()) as { id?: string }).id; } catch { /* mark all */ }
  const where = id
    ? and(eq(schema.notifications.userId, user.id), eq(schema.notifications.id, id))
    : and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt));
  await db.update(schema.notifications).set({ readAt: new Date() }).where(where);
  return NextResponse.json({ ok: true });
}
