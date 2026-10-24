import { redirect } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · TriLens" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: nextRaw } = await searchParams;
  const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/onboarding";
  const user = await getUser();
  if (user) redirect(next);

  return (
    <>
      <SiteHeader />
      <main className="container" style={{ maxWidth: 520, paddingTop: 56 }}>
        <p className="eyebrow">Free audit</p>
        <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.5rem)", margin: "8px 0 12px" }}>Sign in to start your audit</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Your reports are saved under your account, so you can come back to them and compare scans over time.
        </p>
        <div className="panel" style={{ display: "grid", gap: 12, marginTop: 24 }}>
          <a className="btn ink" href={`/api/auth/github?next=${encodeURIComponent(next)}`} style={{ padding: "14px 17px" }}>
            Continue with GitHub
          </a>
          <p className="muted" style={{ fontSize: ".86rem", margin: 0 }}>
            GitHub lets you pick a repo from a list. We ask to read your public profile and email. Private repos are a separate, optional step.
          </p>
          <div className="row" style={{ gap: 10, color: "var(--muted)", fontSize: ".85rem" }}>
            <hr style={{ flex: 1, border: 0, borderTop: "1px solid var(--line)" }} />or<hr style={{ flex: 1, border: 0, borderTop: "1px solid var(--line)" }} />
          </div>
          <a className="btn secondary" href="/signup/email">Use my email instead</a>
        </div>
        <p className="muted" style={{ fontSize: ".84rem", marginTop: 18 }}>
          By continuing you accept the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
        </p>
      </main>
    </>
  );
}
