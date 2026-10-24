import SiteHeader from "../components/SiteHeader";
import InterestButton from "../components/InterestButton";
import { getUser } from "@/lib/session";
import { interestedPlans } from "@/lib/interest";
import { PLAN_PRICES, rupees } from "@/lib/plans";
import "./pricing.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pricing · TriLens" };

type Cell = string | true | false;
const ROWS: { label: string; free: Cell; single: Cell; monthly: Cell }[] = [
  { label: "Scan your GitHub repo (public and private)", free: true, single: true, monthly: true },
  { label: "DPDP, GDPR and CCPA checklist", free: true, single: true, monthly: true },
  { label: "Every gap with its evidence and law reference", free: true, single: true, monthly: true },
  { label: "How to fix each gap", free: false, single: "For one report", monthly: "Every report" },
  { label: "Privacy policy and terms draft", free: "First 2 sections", single: "Full, for one report", monthly: "Full, every report" },
  { label: "Copy and download the policy", free: false, single: true, monthly: true },
  { label: "Publish with the policy widget (human reviewed)", free: false, single: false, monthly: true },
  { label: "Read-only live database check (coming soon)", free: false, single: false, monthly: true },
  { label: "Draft update when your repo changes", free: false, single: false, monthly: true },
];

function show(c: Cell) {
  if (c === true) return <span className="yes" aria-label="Included">●</span>;
  if (c === false) return <span className="no" aria-label="Not included">–</span>;
  return c;
}

export default async function Pricing({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getUser();
  const { error } = await searchParams;
  const mine = user ? await interestedPlans(user.id) : new Set();

  const action = (plan: "single" | "monthly", variant: "primary" | "secondary") =>
    user ? (
      <InterestButton plan={plan} hasEmail={Boolean(user.email)} already={mine.has(plan)} variant={variant} />
    ) : (
      <a className={`btn${variant === "secondary" ? " secondary" : ""}`} href="/signin?next=/pricing">Sign in to register interest</a>
    );

  return (
    <>
      <SiteHeader current="pricing" />
      <main className="container pricing">
        <p className="eyebrow">Pricing</p>
        <h1>Run the audit free. Pay when you want the fixes.</h1>
        <p className="lede">
          Every free scan finds all the gaps and shows the evidence. The paid plans add the fix for each gap and the full privacy policy and terms.
        </p>
        {error && <p className="notice bad">{error}</p>}
        {user?.isPro && <p className="notice good">You already have Pro. <a href="/dashboard">Back to your apps</a></p>}

        <div className="plans">
          <section className="plan" aria-labelledby="p-free">
            <p className="plan-flag">For testing it out</p>
            <h2 id="p-free">Free</h2>
            <p className="price">₹0</p>
            <p className="plan-for">The full scan and every gap it finds, with proof from your own code.</p>
            <ul>
              <li>Unlimited scans</li>
              <li>All gaps with evidence</li>
              <li>First 2 sections of the policy draft</li>
            </ul>
            <a className="btn secondary" href={user ? "/onboarding" : "/signin?next=/onboarding"}>Run a free audit</a>
          </section>

          <section className="plan" aria-labelledby="p-single">
            <p className="plan-flag">One report, no plan</p>
            <h2 id="p-single">Single report</h2>
            <p className="price">{rupees(PLAN_PRICES.single.rupees)}<small>{PLAN_PRICES.single.unit}</small></p>
            <p className="plan-for">Unlock the fixes and full policy for one scan you already ran.</p>
            <ul>
              <li>Fix for every gap in that report</li>
              <li>Full policy and terms draft</li>
              <li>Copy and download</li>
            </ul>
            {action("single", "secondary")}
          </section>

          <section className="plan plan-pro" aria-labelledby="p-pro">
            <p className="plan-flag">For apps you keep shipping</p>
            <h2 id="p-pro">Pro monthly</h2>
            <p className="price">{rupees(PLAN_PRICES.monthly.rupees)}<small>{PLAN_PRICES.monthly.unit}</small></p>
            <p className="plan-for">Everything unlocked on every report, and the policy stays in step with your code.</p>
            <ul>
              <li>Fixes and full policy on all reports</li>
              <li>Publish with the policy widget</li>
              <li>Live database check, coming soon</li>
              <li>Draft updates when your repo changes</li>
            </ul>
            {action("monthly", "primary")}
          </section>
        </div>
        <p className="fine">
          Online payment opens after the hackathon. Register interest now and we'll email you first.
          Have a code from the team? <a href="/redeem">Redeem it</a>. Prices exclude GST.
        </p>

        <h2 className="cmp-title">What each plan includes</h2>
        <div className="cmp-wrap">
          <table className="cmp">
            <thead>
              <tr><th scope="col"><span className="sr">Feature</span></th><th scope="col">Free</th><th scope="col">Single report</th><th scope="col" className="hi">Pro monthly</th></tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{show(r.free)}</td>
                  <td>{show(r.single)}</td>
                  <td className="hi">{show(r.monthly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
