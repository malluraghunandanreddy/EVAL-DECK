// Prices shown on the site. Change them here; the landing page reads its own copy in public/landing.html.
export const PLAN_PRICES = {
  single: { rupees: 50, unit: "per report" },
  // Placeholder until the monthly price is confirmed.
  monthly: { rupees: 499, unit: "per month" },
} as const;

export type PaidPlan = keyof typeof PLAN_PRICES;
export const PAID_PLANS = Object.keys(PLAN_PRICES) as PaidPlan[];
export const PLAN_NAME: Record<PaidPlan, string> = { single: "Single report", monthly: "Pro monthly" };
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
