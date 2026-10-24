import { eq } from "drizzle-orm";
import { db, logEvent, schema } from "./db";

export type NotifyInput = { type: string; title: string; body?: string; href?: string; projectId?: string | null; scanId?: string | null };

/**
 * Write an in-app notification and, when RESEND_API_KEY and the user's email exist, send it by email too.
 * Email failures never fail the caller; the notification still shows on the dashboard.
 */
export async function notify(userId: string, n: NotifyInput): Promise<void> {
  const [row] = await db.insert(schema.notifications)
    .values({ userId, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null, projectId: n.projectId ?? null, scanId: n.scanId ?? null })
    .returning({ id: schema.notifications.id });
  await logEvent("notification", userId, { type: n.type, title: n.title, scanId: n.scanId ?? null, projectId: n.projectId ?? null });

  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user?.email) return;
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const link = n.href ? `${base}${n.href}` : base;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "TriLens <notifications@trilens.app>",
        to: [user.email],
        subject: `TriLens: ${n.title}`,
        text: `${n.title}\n\n${n.body ?? ""}\n\nOpen: ${link}\n\nTriLens is an automated check, not legal advice.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) await db.update(schema.notifications).set({ emailedAt: new Date() }).where(eq(schema.notifications.id, row.id));
    else console.error("email failed", res.status, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error("email failed", (err as Error).message);
  }
}
