import type { ChecklistItem, ChecklistStatus, Coverage, Framework, Gap } from "./types";

type CatalogItem = {
  id: string;
  framework: Framework;
  title: string;
  lawRef: string;
  // needs_db: not_checked without a live DB connection; manual: we cannot verify it from code
  kind?: "needs_db" | "manual";
  fix: string;
};

export const CATALOG: CatalogItem[] = [
  // DPDP (India) — 11 items
  { id: "dpdp_notice_items", framework: "DPDP", title: "Notice lists every personal data item collected", lawRef: "DPDP s.5",
    fix: "Add every data item the code collects (see linked gaps) to the 'What we collect' section of your privacy notice." },
  { id: "dpdp_notice_purposes", framework: "DPDP", title: "Notice lists every purpose of processing", lawRef: "DPDP s.5",
    fix: "For each data item, state the specific purpose (e.g. 'phone: OTP login') in the notice." },
  { id: "dpdp_consent", framework: "DPDP", title: "Consent captured before processing", lawRef: "DPDP s.6",
    fix: "Show the notice and an unticked consent checkbox before sign-up or first data collection; store the consent timestamp." },
  { id: "dpdp_ai_purpose", framework: "DPDP", title: "Data sent to AI/LLM limited to the stated purpose", lawRef: "DPDP s.6",
    fix: "Send only the current message to the LLM, strip phone/email/IDs before the call, and disclose the AI provider in the notice." },
  { id: "dpdp_third_parties", framework: "DPDP", title: "Every third party / processor disclosed", lawRef: "DPDP s.5, s.8(2)",
    fix: "List each vendor found in code (analytics, AI, email, error tracking) as a data processor in the notice, with what it receives." },
  { id: "dpdp_transfers", framework: "DPDP", title: "Transfers outside India disclosed", lawRef: "DPDP s.16",
    fix: "Add a 'Where your data is processed' section naming countries (e.g. US for OpenAI, PostHog) for each vendor." },
  { id: "dpdp_erasure", framework: "DPDP", title: "Personal data erased when no longer needed; deletion path exists", lawRef: "DPDP s.8(7)",
    fix: "Add a delete-account endpoint that removes rows from every PII table (including embeddings), and a scheduled job that deletes data after the stated retention period." },
  { id: "dpdp_security", framework: "DPDP", title: "Reasonable security safeguards: access limited to needed roles, RLS on PII tables", lawRef: "DPDP s.8(5)", kind: "needs_db",
    fix: "Enable row-level security on every PII table and revoke SELECT from anon/PUBLIC; grant access only to the service role." },
  { id: "dpdp_withdrawal", framework: "DPDP", title: "Consent withdrawal as easy as giving it", lawRef: "DPDP s.6(4)", kind: "manual",
    fix: "Add a one-click 'Withdraw consent' in account settings that stops processing and triggers deletion." },
  { id: "dpdp_grievance", framework: "DPDP", title: "Grievance officer / contact published", lawRef: "DPDP s.8(10)", kind: "manual",
    fix: "Publish a grievance officer name and email in the notice and respond within the prescribed period." },
  { id: "dpdp_children", framework: "DPDP", title: "Children's data: verifiable parental consent if under 18", lawRef: "DPDP s.9", kind: "manual",
    fix: "Add an age gate; for users under 18 collect verifiable parental consent and disable tracking/ads." },

  // GDPR (EU/UK) — 9 items
  { id: "gdpr_lawful_basis", framework: "GDPR", title: "Lawful basis stated per purpose", lawRef: "GDPR Art. 6, 13",
    fix: "For each purpose, state the lawful basis (contract, consent, legitimate interest) in the notice." },
  { id: "gdpr_categories", framework: "GDPR", title: "All data categories and recipients disclosed", lawRef: "GDPR Art. 13",
    fix: "List every data category and every recipient (vendor) found in code in the notice." },
  { id: "gdpr_minimisation_ai", framework: "GDPR", title: "Data minimisation for AI calls", lawRef: "GDPR Art. 5(1)(c)",
    fix: "Send only what the AI needs (current message, no history or identifiers); redact PII before the call." },
  { id: "gdpr_retention", framework: "GDPR", title: "Storage limitation: retention period stated and enforced", lawRef: "GDPR Art. 5(1)(e)",
    fix: "State a retention period per data category and enforce it with a scheduled delete (e.g. pg_cron) on PII tables." },
  { id: "gdpr_erasure", framework: "GDPR", title: "Right to erasure possible", lawRef: "GDPR Art. 17",
    fix: "Add a delete-my-data path that removes the user from all tables, vector stores and third-party tools." },
  { id: "gdpr_transfers", framework: "GDPR", title: "International transfers safeguarded", lawRef: "GDPR Art. 44-49",
    fix: "Name non-EU vendors, the transfer mechanism (SCCs / adequacy) and link their DPAs in the notice." },
  { id: "gdpr_security", framework: "GDPR", title: "Security of processing: RBAC and RLS", lawRef: "GDPR Art. 32", kind: "needs_db",
    fix: "Enable RLS on PII tables, revoke broad grants, and restrict reads to the roles that need them." },
  { id: "gdpr_rights_contact", framework: "GDPR", title: "Data subject rights contact", lawRef: "GDPR Art. 12-22", kind: "manual",
    fix: "Publish a privacy contact (or DPO) and explain how to exercise access, rectification, erasure and objection rights." },
  { id: "gdpr_dpas", framework: "GDPR", title: "DPAs signed with processors", lawRef: "GDPR Art. 28", kind: "manual",
    fix: "Sign (or accept online) the data processing agreement of each vendor listed in your notice." },

  // CCPA (US) — 5 items
  { id: "ccpa_notice", framework: "CCPA", title: "Notice at collection lists categories", lawRef: "CCPA 1798.100",
    fix: "Add a notice at collection listing each category of personal information and its purpose." },
  { id: "ccpa_third_parties", framework: "CCPA", title: "Third parties and sale/share disclosed", lawRef: "CCPA 1798.115",
    fix: "List categories of third parties you share personal information with, and whether it is 'sold' or 'shared'." },
  { id: "ccpa_opt_out", framework: "CCPA", title: "'Do Not Sell or Share' link if analytics/ad SDKs present", lawRef: "CCPA 1798.120",
    fix: "Add a 'Do Not Sell or Share My Personal Information' link that disables analytics/ad SDKs for that user." },
  { id: "ccpa_deletion", framework: "CCPA", title: "Deletion request path", lawRef: "CCPA 1798.105",
    fix: "Provide a way to request deletion (form or email) and actually delete from all stores." },
  { id: "ccpa_retention", framework: "CCPA", title: "Retention period per category", lawRef: "CCPA 1798.100(a)(3)",
    fix: "State how long you keep each category of personal information." },
];

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const STATUS_RANK: Record<ChecklistStatus, number> = { todo: 0, not_checked: 1, manual: 2, done: 3 };

export function buildChecklist(frameworks: Framework[], gaps: Gap[], coverage: Coverage): ChecklistItem[] {
  const items: (ChecklistItem & { sev: number })[] = [];
  for (const c of CATALOG) {
    if (!frameworks.includes(c.framework)) continue;
    const linked = gaps.filter((g) => g.checklistIds.includes(c.id));
    let status: ChecklistStatus;
    if (linked.length > 0) status = "todo";
    else if (c.kind === "needs_db" && !coverage.liveDb) status = "not_checked";
    else if (c.kind === "manual") status = "manual";
    else status = "done";
    const sev = linked.length ? Math.min(...linked.map((g) => SEVERITY_RANK[g.severity])) : 3;
    items.push({ id: c.id, framework: c.framework, title: c.title, lawRef: c.lawRef, status, gapIds: linked.map((g) => g.id), fix: c.fix, sev });
  }
  items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.sev - b.sev);
  return items.map(({ sev: _sev, ...rest }) => rest);
}

export function headline(items: ChecklistItem[], framework: Framework): string {
  const mine = items.filter((i) => i.framework === framework);
  return `${framework}: ${mine.filter((i) => i.status === "done").length} of ${mine.length} done`;
}

// Free tier: server strips fix steps. Never rely on the UI for this.
export function stripFixes<T extends { fix?: string }>(list: T[]): T[] {
  return list.map(({ fix: _fix, ...rest }) => rest as T);
}
