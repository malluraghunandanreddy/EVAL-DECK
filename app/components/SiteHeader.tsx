import { getUser } from "@/lib/session";

type Current = "dashboard" | "pricing" | "scan" | "other";

export default async function SiteHeader({ current = "other" }: { current?: Current }) {
  let user = null;
  try {
    user = await getUser();
  } catch {
    user = null;
  }
  return (
    <header className="site-top">
      <div className="site-top-in">
        <a className="site-brand" href="/">
          <svg viewBox="0 0 28 26" width="26" height="24" aria-hidden="true">
            <path d="M14 4 L24.2 21.8 H3.8 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="14" cy="4" r="3" fill="var(--mark)" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="3.8" cy="21.8" r="3" fill="var(--panel)" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="24.2" cy="21.8" r="3" fill="var(--panel)" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          TriLens
        </a>
        <nav className="site-nav" aria-label="Main">
          {user && <a href="/dashboard" className={current === "dashboard" ? "current" : undefined}>Dashboard</a>}
          <a href="/pricing" className={current === "pricing" ? "current" : undefined}>Pricing</a>
          {user ? (
            <a href="/api/auth/logout">Sign out</a>
          ) : (
            <a href="/signin" className="btn" style={{ padding: "8px 14px", fontSize: ".9rem", marginLeft: 6 }}>Sign in</a>
          )}
        </nav>
      </div>
    </header>
  );
}
