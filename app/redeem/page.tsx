import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, logEvent } from "@/lib/db";
import { getUser } from "@/lib/session";
import { safeEqual } from "@/lib/crypto";
import SiteHeader from "../components/SiteHeader";

export const dynamic = "force-dynamic";

function codeHash(code: string) {
  return createHash("sha256").update(`policydrift-pro:${code}`).digest("hex");
}

async function redeem(formData: FormData) {
  "use server";
  const user = await getUser();
  if (!user) redirect("/api/auth/github?next=/redeem");
  if (user.isPro) redirect("/dashboard");

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const codes = (process.env.PRO_UNLOCK_CODES ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (!code || !codes.some((c) => safeEqual(c, code))) redirect("/redeem?error=invalid");

  const hash = codeHash(code);
  const [used] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.type, "payment"), sql`${schema.events.payload}->>'code_hash' = ${hash}`))
    .limit(1);
  if (used) redirect("/redeem?error=used");

  // Record the use first so a second tab cannot reuse it, then flip Pro.
  await logEvent("payment", user.id, { method: "code", code_hash: hash });
  await db.update(schema.users).set({ isPro: true }).where(eq(schema.users.id, user.id));
  redirect("/dashboard?upgraded=1");
}

const ERRORS: Record<string, string> = {
  invalid: "That code is not valid.",
  used: "That code has already been used.",
};

export default async function Redeem({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getUser();
  const { error } = await searchParams;
  return (
    <>
    <SiteHeader />
    <main className="container" style={{ maxWidth: 480 }}>
      <h1>Redeem a Pro code</h1>
      {!user ? (
        <a className="btn" href="/signin?next=/redeem">Sign in first</a>
      ) : user.isPro ? (
        <p>You are already on Pro. <a href="/dashboard">Back to your apps</a></p>
      ) : (
        <form action={redeem} className="panel">
          {error && <p style={{ color: "var(--bad)", marginTop: 0 }}>{ERRORS[error] ?? "Something went wrong."}</p>}
          <label htmlFor="code">One-time code</label>
          <input id="code" name="code" required autoComplete="off" maxLength={64} />
          <button className="btn" type="submit" style={{ marginTop: 12 }}>Unlock Pro</button>
        </form>
      )}
    </main>
    </>
  );
}
