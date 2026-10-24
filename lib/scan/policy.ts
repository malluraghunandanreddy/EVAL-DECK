import { z } from "zod";
import type { PolicyClaims } from "../types";
import { parseJsonOutput, runAgent } from "../ai";
import { SDK_CATALOG } from "./catalog";
import type { RepoFile } from "./files";
import { classifyText } from "./pii";

export const MAX_POLICY_CHARS = 30_000;

export const NO_POLICY: PolicyClaims = { collected: [], purposes: [], thirdParties: [], retention: null, crossBorder: null, noPolicy: true };

const ClaimsSchema = z.object({
  collected: z.array(z.string()).default([]),
  purposes: z.array(z.string()).default([]),
  thirdParties: z.array(z.string()).default([]),
  retention: z.string().nullable().default(null),
  crossBorder: z.string().nullable().default(null),
  noPolicy: z.boolean().default(false),
});

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_POLICY_CHARS);
}

/** Fetch a policy URL and strip it to text. Returns null on any failure. */
export async function fetchPolicyText(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(u, { signal: ctrl.signal, headers: { "User-Agent": "PolicyDrift/0.1 (+policy scanner)" }, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, 2_000_000);
    const text = /<html|<body|<p[\s>]/i.test(body) ? htmlToText(body) : body.slice(0, MAX_POLICY_CHARS);
    return text.trim().length > 50 ? text : null;
  } catch {
    return null;
  }
}

/** A privacy policy committed in the repo (PRIVACY.md, privacy-policy.html, ...), shallowest first. */
export function findPolicyInRepo(files: RepoFile[]): string | null {
  const candidates = files
    .filter((f) => /(^|\/)[^/]*privacy[^/]*\.(md|txt|html?|mdx)$/i.test(f.rel) && f.rel.split("/").length <= 4)
    .sort((a, b) => a.rel.split("/").length - b.rel.split("/").length);
  const f = candidates[0];
  if (!f) return null;
  return /\.html?$/i.test(f.rel) ? htmlToText(f.text) : f.text.slice(0, MAX_POLICY_CHARS);
}

const PURPOSES: [RegExp, string][] = [
  [/authenticat|log ?in|sign ?in|account/i, "authentication"],
  [/analytic|improve (our|the) (service|product)|usage statistics/i, "analytics"],
  [/marketing|newsletter|promotion|advertis/i, "marketing"],
  [/support|customer service|help ?desk/i, "customer support"],
  [/payment|billing|invoice/i, "payments"],
  [/security|fraud/i, "security"],
  [/personali[sz]/i, "personalisation"],
  [/(provide|operate|deliver) (the|our) service/i, "service delivery"],
];

const NEGATION = /\b(never|not|no|don't|do not|without|nor)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Deterministic fallback: keyword matching over the policy text. */
export function keywordClaims(text: string | null): PolicyClaims {
  if (!text || text.trim().length < 30) return { ...NO_POLICY };
  const sents = sentences(text);
  const collected = new Set<string>();
  const purposes = new Set<string>();
  for (const s of sents) {
    // skip sentences that deny collecting/sharing ("we never collect your phone number")
    const denies = NEGATION.test(s) && /collect|store|process|share|sell/i.test(s);
    if (!denies) for (const d of classifyText(s)) collected.add(d);
    for (const [re, p] of PURPOSES) if (re.test(s)) purposes.add(p);
  }
  const thirdParties = new Set<string>();
  for (const e of SDK_CATALOG) {
    const names = [e.vendor, e.vendor.split(" ")[0], e.id.replace(/_/g, " ")];
    if (names.some((n) => n.length > 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))) thirdParties.add(e.vendor);
  }
  const retention = sents.find((s) => /\b(retain|retention|keep your (data|information)|stored for|delete[ds]? after)\b/i.test(s)) ?? null;
  const crossBorder = sents.find((s) => /transfer|outside (india|the eu|the european|your country)|international|cross[- ]border|other countries|united states/i.test(s) && !/never/i.test(s)) ?? null;
  return { collected: [...collected], purposes: [...purposes], thirdParties: [...thirdParties], retention, crossBorder, noPolicy: false };
}

/** Policy Reader agent (AgenticOrg) -> strict PolicyClaims; keyword fallback on failure or timeout (30 s). */
export async function extractClaims(text: string | null): Promise<{ claims: PolicyClaims; source: "agent" | "keywords" | "none" }> {
  if (!text || text.trim().length < 30) return { claims: { ...NO_POLICY }, source: "none" };
  const run = await runAgent(process.env.AGENTICORG_READER_AGENT_ID, "extract_claims", { policy_text: text.slice(0, MAX_POLICY_CHARS) }, 30_000);
  if (run && !run.error) {
    const parsed = ClaimsSchema.safeParse(parseJsonOutput(run.output));
    if (parsed.success) return { claims: { ...parsed.data, noPolicy: false }, source: "agent" };
  }
  return { claims: keywordClaims(text), source: "keywords" };
}
