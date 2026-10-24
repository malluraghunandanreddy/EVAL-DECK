import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema, logEvent } from "@/lib/db";
import { setSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  github_not_configured: "GitHub sign-in is not configured yet. Use your email below.",
  github_denied: "GitHub sign-in was cancelled.",
  bad_state: "GitHub sign-in expired or was tampered with. Try again.",
  token_exchange_failed: "GitHub sign-in failed. Try again, or use your email below.",
  github_user_failed: "Could not read your GitHub profile. Try again, or use your email below.",
  invalid_email: "Enter a valid email address.",
};

async function signupWithEmail(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) redirect("/signup/email?error=invalid_email");

  // Email-only users have no github_id; reuse the same row if they come back.
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.githubId)))
    .limit(1);
  let userId = existing?.id;
  if (!userId) {
    const [created] = await db.insert(schema.users).values({ email }).returning({ id: schema.users.id });
    userId = created.id;
    await logEvent("signup", userId, { method: "email" });
  }
  await setSession(userId);
  redirect("/onboarding");
}

export default async function EmailSignup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? `Sign-in problem: ${error}` : null;
  return (
    <main className="container" style={{ maxWidth: 480 }}>
      <h1>Sign up with email</h1>
      <p className="muted">
        Fallback sign-up without GitHub. You can connect GitHub later to pick a repository.
      </p>
      {message && (
        <p className="panel" style={{ borderColor: "var(--bad)" }}>
          {message}
        </p>
      )}
      <form action={signupWithEmail} className="panel">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" type="submit">Continue</button>
          <a className="btn secondary" href="/api/auth/github">Sign in with GitHub instead</a>
        </div>
      </form>
    </main>
  );
}
