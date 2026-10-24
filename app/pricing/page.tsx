import { getUser } from "@/lib/session";
import { PRO_PRICE_PAISE } from "@/lib/pinelabs";

export const dynamic = "force-dynamic";

const ROWS: [string, string, string][] = [
  ["GitHub repo scan (public and private)", "Yes", "Yes"],
  ["DPDP, GDPR and CCPA checklists", "Yes", "Yes"],
  ["Every gap with evidence and law reference", "Yes", "Yes"],
  ["How to fix each gap", "Locked", "Yes"],
  ["Privacy policy and terms draft", "First 2 sections", "Full, copy and download"],
  ["Publish policy after human review (widget)", "-", "Yes"],
  ["Live database check (read-only): RLS, who can read PII", "-", "Yes"],
  ["Re-review when your repo changes", "Report only", "Draft update for review"],
];

export default async function Pricing({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getUser();
  const { error } = await searchParams;
  const price = `Rs ${PRO_PRICE_PAISE / 100}`;
  const cell: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid var(--line)", textAlign: "left" };

  return (
    <main className="container" style={{ maxWidth: 760 }}>
      <h1>Pricing</h1>
      {error && (
        <p className="panel" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</p>
      )}
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}></th>
              <th style={cell}>Free</th>
              <th style={{ ...cell, color: "var(--accent)" }}>Pro · {price} one-time</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([f, free, pro]) => (
              <tr key={f}>
                <td style={cell}>{f}</td>
                <td style={{ ...cell, color: "var(--muted)" }}>{free}</td>
                <td style={cell}>{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        {user?.isPro ? (
          <p style={{ margin: 0 }}>You are on Pro. <a href="/dashboard">Back to your apps</a></p>
        ) : user ? (
          <>
            <form action="/api/billing/checkout" method="post" className="row">
              <button className="btn" type="submit">Upgrade to Pro · {price}</button>
              <span className="muted" style={{ fontSize: 13 }}>Secure checkout by Pine Labs</span>
            </form>
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Test mode: use card <strong>4012 0010 3714 1112</strong>, CVV <strong>065</strong>, any future expiry.
              <br />
              Have a Pro code? <a href="/redeem">Redeem it</a>.
            </p>
          </>
        ) : (
          <a className="btn" href="/api/auth/github?next=/pricing">Sign in with GitHub to upgrade</a>
        )}
      </div>
    </main>
  );
}
