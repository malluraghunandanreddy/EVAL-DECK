import { redirect } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { getUser } from "@/lib/session";
import { ownedScan } from "@/lib/agent/access";
import { PLAN_NAME, PLAN_PRICES, rupees, type PaidPlan } from "@/lib/plans";
import { grantMonthly, grantSingle, isMonthly, transactionAccepted } from "@/lib/entitlements";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout · TriLens" };

const isPlan = (p: string): p is PaidPlan => p === "single" || p === "monthly";

async function pay(formData: FormData) {
  "use server";
  const plan = String(formData.get("plan") ?? "");
  const scanId = String(formData.get("scan") ?? "").trim();
  const txn = String(formData.get("txn") ?? "");
  const here = `/pay?plan=${encodeURIComponent(plan)}${scanId ? `&scan=${encodeURIComponent(scanId)}` : ""}`;
  const back = (error: string): never => redirect(`${here}&error=${error}`);

  const user = await getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(here)}`);
  if (!isPlan(plan)) return back("plan");
  if (!transactionAccepted(txn)) return back("txn");

  if (plan === "monthly") {
    await grantMonthly(user.id, txn);
    redirect(scanId ? `/scan/${scanId}?upgraded=1` : "/dashboard?upgraded=1");
  }
  const owned = await ownedScan(scanId, user);
  if (!owned) return back("scan");
  await grantSingle(user.id, owned.scan, txn);
  redirect(`/scan/${scanId}?upgraded=1`);
}

const ERRORS: Record<string, string> = {
  txn: "We could not verify that transaction reference. Check it and try again, or ask the team at the table.",
  scan: "Pick the report you want to unlock from your dashboard first.",
  plan: "Unknown plan.",
};

const INCLUDES: Record<PaidPlan, string[]> = {
  single: ["How to fix every gap in this report", "Full privacy policy and terms draft", "Copy and download", "Read-only database check for this report"],
  monthly: ["Everything in Single report, on every report", "Publish a hosted policy page and widget, reviewed by a human", "Drift Watch agent: re-check, notification and policy update on every push", "30 days from today"],
};

export default async function Pay({ searchParams }: { searchParams: Promise<{ plan?: string; scan?: string; error?: string }> }) {
  const { plan = "monthly", scan = "", error } = await searchParams;
  const user = await getUser();
  const chosen: PaidPlan = isPlan(plan) ? plan : "monthly";
  const price = PLAN_PRICES[chosen];
  const here = `/pay?plan=${chosen}${scan ? `&scan=${scan}` : ""}`;

  let body;
  if (!user) {
    body = <a className="btn" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in to continue</a>;
  } else if (chosen === "monthly" && isMonthly(user)) {
    body = <p>You are already on Pro monthly. <a href="/dashboard">Back to your apps</a></p>;
  } else if (chosen === "single" && !scan) {
    body = <p>Single reports are unlocked from the report itself. <a href="/dashboard">Open a report</a> and click Unlock.</p>;
  } else {
    body = (
      <form action={pay} className="panel" style={{ display: "grid", gap: 10 }}>
        <input type="hidden" name="plan" value={chosen} />
        <input type="hidden" name="scan" value={scan} />
        {error && <p style={{ color: "var(--bad)", margin: 0 }}>{ERRORS[error] ?? "Something went wrong."}</p>}
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Online card payment through Pine Labs opens after the hackathon. For now, pay the TriLens team and enter the
          transaction reference they confirm.
        </p>
        <label htmlFor="txn">Transaction reference</label>
        <input id="txn" name="txn" required autoComplete="off" inputMode="numeric" maxLength={64} placeholder="e.g. UPI reference number" />
        <button className="btn" type="submit">Confirm payment of {rupees(price.rupees)}</button>
      </form>
    );
  }

  return (
    <>
      <SiteHeader current="pricing" />
      <main className="container" style={{ maxWidth: 560 }}>
        <p className="eyebrow">Checkout</p>
        <h1>{PLAN_NAME[chosen]}</h1>
        <p style={{ fontSize: 22, margin: "4px 0 12px" }}>{rupees(price.rupees)} <small className="muted">{price.unit}</small></p>
        <ul style={{ marginTop: 0 }}>{INCLUDES[chosen].map((i) => <li key={i}>{i}</li>)}</ul>
        {body}
        <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
          Not legal advice. Prices exclude GST. <a href="/pricing">Compare plans</a>
        </p>
      </main>
    </>
  );
}
