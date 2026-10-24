import type { Framework, Gap, PolicyClaims } from "../types";
import type { Project, Scan } from "../db/schema";
import { computeInventory, labelFor, projectFrameworks, scanParts, type Inventory, type ScanParts, type VendorInfo } from "./inventory";

// Deterministic privacy policy + terms drafts. Always available, no AI needed.
// The AgenticOrg Compliance Reviewer may rewrite these; this is the baseline and the fallback.

export const COMPANY = "[Company name]";
export const CONTACT = "[Contact email]";
export const NOT_LEGAL_ADVICE =
  "_Drafted by PolicyDrift from an automated scan of the app's code and storage. Not legal advice: have it reviewed before you rely on it._";

export type PolicyDraft = { policyMd: string; termsMd: string; summary: string };

export type PolicyInput = ScanParts & {
  appName: string;
  frameworks: Framework[];
  date?: Date;
};

const PURPOSES: Record<string, string> = {
  email: "Create and secure your account and send you service messages",
  phone: "Contact you and verify your identity (for example with a one-time password)",
  ip: "Keep the service secure, prevent abuse and diagnose errors",
  address: "Deliver the products or services you ask for",
  chat_history: "Answer your questions, including by sending your messages to our AI provider",
  device: "Understand how the app is used and fix crashes",
  aadhaar: "Verify your identity where the law requires it",
  pan: "Verify your identity and meet tax obligations where the law requires it",
  name: "Identify you in your account",
  dob: "Confirm your age and eligibility",
  gender: "Personalise the service",
  location: "Provide location-based features",
  payment: "Process your payments",
  embeddings: "Search past support conversations to give better answers",
};

const LAWFUL_BASIS: Record<string, string> = {
  email: "Contract (Art. 6(1)(b))",
  name: "Contract (Art. 6(1)(b))",
  phone: "Contract (Art. 6(1)(b))",
  address: "Contract (Art. 6(1)(b))",
  payment: "Contract (Art. 6(1)(b))",
  chat_history: "Contract (Art. 6(1)(b))",
  embeddings: "Legitimate interests (Art. 6(1)(f)): improving answers",
  ip: "Legitimate interests (Art. 6(1)(f)): security",
  device: "Consent (Art. 6(1)(a)) for analytics; legitimate interests for crash reports",
  aadhaar: "Legal obligation (Art. 6(1)(c))",
  pan: "Legal obligation (Art. 6(1)(c))",
};

const CCPA_CATEGORIES: [string, string[]][] = [
  ["Identifiers", ["email", "phone", "name", "address", "ip"]],
  ["Government identifiers (sensitive personal information)", ["aadhaar", "pan"]],
  ["Internet or other electronic network activity", ["device", "ip"]],
  ["Electronic communications (content of your messages)", ["chat_history", "embeddings"]],
  ["Geolocation data", ["location"]],
  ["Commercial and financial information", ["payment"]],
  ["Characteristics of protected classifications", ["dob", "gender"]],
];

const REGION_NAME: Record<VendorInfo["region"], string> = {
  us: "United States",
  eu: "European Union",
  in: "India",
  unknown: "[Country, confirm with the vendor]",
};

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function esc(s: string): string {
  // keep table cells and list items on one line
  return s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sharesAcrossBorders(inv: Inventory, home: VendorInfo["region"]): VendorInfo[] {
  return inv.vendors.filter((v) => v.region !== home);
}

export function generatePolicy(input: PolicyInput): PolicyDraft {
  const inv = computeInventory(input, input.frameworks);
  const claims: PolicyClaims | null = input.claims;
  const date = fmtDate(input.date ?? new Date());
  const app = input.appName || "[App name]";
  const fw = input.frameworks;
  const retention = claims?.retention?.trim() || "[Retention period, e.g. 12 months after you close your account]";

  const types = inv.dataTypes.length ? inv.dataTypes : ["email"];
  const s: string[] = [];

  s.push(`# ${app} Privacy Policy\n\nLast updated: ${date}\n\n${NOT_LEGAL_ADVICE}`);

  s.push(
    `## Who we are\n\n${app} is operated by ${COMPANY} ("we", "us"). This policy explains what personal data ${app} collects, why, who receives it and the rights you have. ` +
      `Questions or requests: ${CONTACT}.`,
  );

  s.push(
    `## What we collect\n\nBased on how ${app} works today, we collect:\n\n` +
      bullets(types.map((t) => `**${labelFor(t)}**`)) +
      (inv.hasVectorStore
        ? `\n\nWe convert some of your messages into text embeddings (numeric representations) to search past conversations. Embeddings are personal data and are covered by this policy, including deletion.`
        : ""),
  );

  const purposeLines = types.map((t) => `**${labelFor(t)}**: ${PURPOSES[t] ?? "[Purpose for this data]"}`);
  const extraPurposes = (claims?.purposes ?? []).filter(Boolean).map((p) => esc(p));
  s.push(
    `## Why we use it\n\n` +
      bullets(purposeLines) +
      (extraPurposes.length ? `\n\nWe also use data to:\n\n${bullets(extraPurposes)}` : "") +
      `\n\nWe do not use your data for any purpose not listed here without telling you first${fw.includes("DPDP") || fw.includes("GDPR") ? " and, where needed, asking for your consent" : ""}.`,
  );

  if (inv.vendors.length) {
    s.push(
      `## Who we share it with\n\nWe use these service providers (processors). Each receives only what it needs to provide its service to us:\n\n` +
        `| Provider | What it does | Data it receives | Location |\n|---|---|---|---|\n` +
        inv.vendors
          .map((v) => `| ${esc(v.name)} | ${v.category} | ${v.dataTypes.length ? v.dataTypes.map(labelFor).join(", ") : "[Data shared]"} | ${REGION_NAME[v.region]} |`)
          .join("\n") +
        `\n\nWe do not sell your personal data.`,
    );
  } else {
    s.push(`## Who we share it with\n\nWe do not currently share your personal data with third parties, other than our hosting provider [Hosting provider]. We do not sell your personal data.`);
  }

  if (inv.usesAi) {
    const ai = inv.vendors.filter((v) => v.category === "AI model provider").map((v) => v.name);
    s.push(
      `## AI features\n\n${app} uses ${ai.length ? ai.join(", ") : "a third-party AI model provider"} to generate responses. When you use these features, the content you send` +
        `${types.includes("chat_history") ? " (and, to keep context, earlier messages in the conversation)" : ""} is sent to that provider. ` +
        `We send only what is needed to answer you, and we remove identifiers such as phone numbers and email addresses where we can. [Confirm whether the provider may use this data for training.]`,
    );
  }

  const abroad = sharesAcrossBorders(inv, fw.includes("DPDP") ? "in" : "eu");
  s.push(
    `## Where your data is processed\n\n` +
      (abroad.length
        ? `Some providers process data outside ${fw.includes("DPDP") ? "India" : "the EU/UK"}:\n\n` +
          bullets(abroad.map((v) => `${esc(v.name)}: ${REGION_NAME[v.region]}`)) +
          (claims?.crossBorder ? `\n\n${esc(claims.crossBorder)}` : "")
        : `We store and process your data in [Country/region of hosting].`),
  );

  s.push(
    `## How long we keep it\n\nWe keep your personal data for ${retention}, then delete or anonymise it. ` +
      `You can ask us to delete your account and data at any time by writing to ${CONTACT}; we delete it from our database${inv.hasVectorStore ? ", our embeddings store" : ""} and ask our providers to do the same.`,
  );

  s.push(
    `## How we protect it\n\nWe use encryption in transit, access controls that limit who can read personal data to the people and systems that need it${
      inv.piiTables.length ? ` (including row-level security on tables that hold personal data such as ${inv.piiTables.slice(0, 4).map((t) => `\`${t}\``).join(", ")})` : ""
    }, and we review access regularly.`,
  );

  if (fw.includes("DPDP")) {
    s.push(
      `## Your rights in India (DPDP Act, 2023)\n\n` +
        bullets([
          "**Notice and consent:** we show you this notice and ask for your consent before we process your data (s.5, s.6).",
          `**Withdraw consent** as easily as you gave it: use [Settings > Privacy] or email ${CONTACT}. We then stop processing and delete your data unless the law requires us to keep it (s.6(4)).`,
          "**Access, correction and erasure** of your personal data, and to nominate someone to exercise your rights (s.11 to s.14).",
          `**Grievance officer:** [Grievance officer name], ${CONTACT}. We respond within [number] days (s.8(10)).`,
          "**Complain to the Data Protection Board of India** if you are not satisfied with our response (s.13).",
        ]),
    );
  }

  if (fw.includes("GDPR")) {
    s.push(
      `## Your rights in the EU and UK (GDPR)\n\n**Lawful basis for each use:**\n\n| Data | Purpose | Lawful basis |\n|---|---|---|\n` +
        types.map((t) => `| ${labelFor(t)} | ${PURPOSES[t] ?? "[Purpose]"} | ${LAWFUL_BASIS[t] ?? "Consent (Art. 6(1)(a))"} |`).join("\n") +
        `\n\n` +
        bullets([
          "**Your rights:** access, rectification, erasure, restriction, portability and objection (Art. 15 to 21), and to withdraw consent at any time.",
          `**International transfers:** where data leaves the EU/UK we rely on Standard Contractual Clauses or an adequacy decision (Art. 44 to 49). [Link each provider's DPA.]`,
          `**Contact / Data Protection Officer:** [DPO name or privacy lead], ${CONTACT}.`,
          "**Complaint:** you can complain to your local data protection authority.",
        ]),
    );
  }

  if (fw.includes("CCPA")) {
    const cats = CCPA_CATEGORIES.filter(([, ts]) => ts.some((t) => types.includes(t))).map(([c]) => c);
    s.push(
      `## Your rights in California (CCPA)\n\n**Categories of personal information we collect:**\n\n` +
        bullets(cats.length ? cats : ["Identifiers"]) +
        `\n\n**Sources:** directly from you and automatically from your device when you use ${app}.\n\n` +
        bullets([
          inv.hasAnalytics
            ? `**Do Not Sell or Share My Personal Information:** our analytics providers may count as "sharing" for cross-context behavioural advertising. Use the [Do Not Sell or Share] link in the app footer or email ${CONTACT} to opt out.`
            : `**Do Not Sell or Share:** we do not sell or share your personal information.`,
          "**Right to know** what we collect, use and disclose, and **right to delete** it (1798.100, 1798.105, 1798.110).",
          "**Right to correct** inaccurate information, and to **non-discrimination** for using your rights.",
          `**Retention:** we keep each category for ${retention} (1798.100(a)(3)).`,
        ]),
    );
  }

  s.push(
    `## Children\n\n${app} is not intended for children${fw.includes("DPDP") ? " under 18. If a user under 18 needs access, we will obtain verifiable consent from a parent or guardian (DPDP s.9)" : " under 16"}. If you believe a child has given us data, contact ${CONTACT}.`,
  );

  s.push(`## Changes to this policy\n\nWe will update this policy when ${app} starts collecting new data or uses a new provider, and show the date at the top. Material changes will be notified in the app or by email.`);

  const policyMd = s.join("\n\n") + "\n";
  const termsMd = generateTerms(app, inv, date);
  const summary = buildSummary(app, inv, input.gaps, fw);
  return { policyMd, termsMd, summary };
}

export function generateTerms(app: string, inv: Inventory, date: string): string {
  const s: string[] = [];
  s.push(`# ${app} Terms of Service\n\nLast updated: ${date}\n\n${NOT_LEGAL_ADVICE}`);
  s.push(`## Agreement\n\nThese terms are an agreement between you and ${COMPANY} for your use of ${app}. By using ${app} you accept them. If you do not agree, do not use the service.`);
  s.push(`## Your account\n\nYou must give accurate information, keep your login secure and tell us at ${CONTACT} if you think your account was misused. You must be [18] or older, or have a parent's or guardian's consent.`);
  s.push(`## Acceptable use\n\nDo not misuse ${app}: no unlawful content, no attempts to break or overload the service, no scraping, and no uploading other people's personal data without a right to do so.`);
  if (inv.usesAi) {
    s.push(`## AI-generated content\n\n${app} uses AI to generate responses. Responses can be wrong or incomplete; check important information yourself. Do not enter sensitive personal data (such as government IDs or health details) into AI features.`);
  }
  if (inv.vendors.some((v) => v.category === "Payments")) {
    s.push(`## Payments\n\nPaid features are billed through our payment provider. Prices, renewal and refund terms are shown at checkout. [Refund policy.]`);
  }
  s.push(`## Privacy\n\nOur Privacy Policy explains how we handle your personal data and forms part of these terms.`);
  s.push(`## Disclaimers and liability\n\n${app} is provided "as is". To the extent the law allows, ${COMPANY} is not liable for indirect or consequential loss, and our total liability is limited to the amount you paid us in the last 12 months.`);
  s.push(`## Ending the service\n\nYou can stop using ${app} and delete your account at any time. We may suspend accounts that break these terms.`);
  s.push(`## Changes and contact\n\nWe may update these terms and will show the new date above. These terms are governed by the laws of [Jurisdiction]. Contact: ${CONTACT}.`);
  return s.join("\n\n") + "\n";
}

function buildSummary(app: string, inv: Inventory, gaps: Gap[], fw: Framework[]): string {
  const high = gaps.filter((g) => g.severity === "high").length;
  const vendors = inv.vendors.map((v) => v.name);
  const parts = [
    `Draft privacy policy and terms for ${app} covering ${fw.join(", ")}.`,
    `It discloses ${inv.dataTypes.length} kinds of personal data${vendors.length ? ` and ${vendors.length} providers (${vendors.slice(0, 5).join(", ")}${vendors.length > 5 ? ", ..." : ""})` : ""}.`,
    gaps.length ? `Written to close ${gaps.length} gaps from the scan (${high} high severity); code fixes such as deletion paths still need to be built.` : "",
    `Fill in the bracketed placeholders before publishing. Not legal advice.`,
  ];
  return parts.filter(Boolean).join(" ");
}

export function generateFromScan(scan: Scan, project: Pick<Project, "name" | "frameworks">): PolicyDraft {
  return generatePolicy({ ...scanParts(scan), appName: project.name, frameworks: projectFrameworks(project) });
}

export type Section = { title: string; md: string };

// Split Markdown into `##` sections. Anything before the first `##` (title, date, disclaimer)
// is folded into the first section so the free preview still shows it.
export function previewSections(md: string): Section[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  const preamble: string[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (cur) sections.push({ title: cur.title, md: cur.lines.join("\n").trim() });
      cur = { title: m[1], lines: [line] };
    } else if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (cur) sections.push({ title: cur.title, md: cur.lines.join("\n").trim() });
  const pre = preamble.join("\n").trim();
  if (!sections.length) {
    const h1 = pre.match(/^#\s+(.+)$/m);
    return pre ? [{ title: h1?.[1] ?? "Policy", md: pre }] : [];
  }
  if (pre) sections[0] = { title: sections[0].title, md: `${pre}\n\n${sections[0].md}` };
  return sections;
}

export const FREE_SECTIONS = 2;

// Agent output sanity: keep only drafts that look like real Markdown and carry the disclaimer.
export function ensureDisclaimer(md: string): string {
  return /not legal advice/i.test(md) ? md : `${md.trim()}\n\n${NOT_LEGAL_ADVICE}\n`;
}
