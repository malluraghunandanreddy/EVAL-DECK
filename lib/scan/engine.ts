import type { CodeFinding, DbFinding, Framework, Gap, LawRef, PolicyClaims, SchemaFinding } from "../types";
import { SDK_CATALOG } from "./catalog";
import { classifyText, DATA_TYPE_LABEL } from "./pii";

export type EngineSignals = {
  consentCaptured: boolean; doNotSellLink: boolean; hasRetentionJob: boolean;
  hasCi?: boolean; hasTests?: boolean;
  secrets?: { file: string; line: number; kind: string }[];
};

/** A data promise made by one of the project's legal documents (privacy policy, terms, NDA, ...). */
export type DocPromise = { doc: string; kind: "retention" | "deletion" | "sharing" | "no_sharing" | "confidentiality" | "storage_location"; text: string };
export type DocConflict = { title: string; docs: string[]; detail: string; severity: "high" | "medium" | "low" };

export type EngineInput = {
  frameworks: Framework[];
  codeFindings: CodeFinding[];
  schemaFindings: SchemaFinding[];
  dbFindings?: DbFinding[] | null;
  claims: PolicyClaims;
  signals?: Partial<EngineSignals>;
  /** Promises extracted from every legal document; checked against code and against each other. */
  docPromises?: DocPromise[];
  docConflicts?: DocConflict[];
};

// Law citations, short text in plain English.
const LAW = {
  DPDP_5: { regime: "DPDP", ref: "DPDP Act 2023, s.5", text: "Notice must list the personal data collected and the purpose before or at the time of consent." },
  DPDP_6: { regime: "DPDP", ref: "DPDP Act 2023, s.6", text: "Consent must be free, specific, informed and limited to the personal data necessary for the specified purpose." },
  DPDP_8_2: { regime: "DPDP", ref: "DPDP Act 2023, s.8(2)", text: "A Data Fiduciary may engage a Data Processor only under a valid contract and remains responsible for it." },
  DPDP_8_5: { regime: "DPDP", ref: "DPDP Act 2023, s.8(5)", text: "Reasonable security safeguards must be taken to prevent personal data breach." },
  DPDP_8_7: { regime: "DPDP", ref: "DPDP Act 2023, s.8(7)", text: "Personal data must be erased once the purpose is served or consent is withdrawn." },
  DPDP_16: { regime: "DPDP", ref: "DPDP Act 2023, s.16", text: "Transfers outside India are subject to Government restrictions and should be disclosed." },
  GDPR_5_1_B: { regime: "GDPR", ref: "GDPR Art. 5(1)(b)", text: "Purpose limitation: data collected for specified purposes, not further processed incompatibly." },
  GDPR_5_1_C: { regime: "GDPR", ref: "GDPR Art. 5(1)(c)", text: "Data minimisation: adequate, relevant and limited to what is necessary." },
  GDPR_5_1_E: { regime: "GDPR", ref: "GDPR Art. 5(1)(e)", text: "Storage limitation: kept no longer than necessary for the purposes." },
  GDPR_6: { regime: "GDPR", ref: "GDPR Art. 6", text: "Processing needs a lawful basis such as consent, contract or legitimate interest." },
  GDPR_13: { regime: "GDPR", ref: "GDPR Art. 13", text: "At collection, inform data subjects of the categories, purposes, lawful basis, recipients and retention." },
  GDPR_13_1_E: { regime: "GDPR", ref: "GDPR Art. 13(1)(e)", text: "The recipients or categories of recipients of the personal data must be disclosed." },
  GDPR_17: { regime: "GDPR", ref: "GDPR Art. 17", text: "Data subjects have the right to erasure of their personal data." },
  GDPR_32: { regime: "GDPR", ref: "GDPR Art. 32", text: "Appropriate technical measures, including access control, must secure processing." },
  GDPR_44: { regime: "GDPR", ref: "GDPR Art. 44-49", text: "Transfers outside the EU/EEA need adequacy or appropriate safeguards (e.g. SCCs)." },
  CCPA_100: { regime: "CCPA", ref: "Cal. Civ. Code 1798.100", text: "A notice at collection must list the categories of personal information collected and purposes." },
  CCPA_100_A3: { regime: "CCPA", ref: "Cal. Civ. Code 1798.100(a)(3)", text: "The notice must state how long each category of personal information is retained." },
  CCPA_105: { regime: "CCPA", ref: "Cal. Civ. Code 1798.105", text: "Consumers have the right to request deletion of their personal information." },
  CCPA_115: { regime: "CCPA", ref: "Cal. Civ. Code 1798.115", text: "Consumers have the right to know the categories of third parties personal information is sold or shared with." },
  CCPA_120: { regime: "CCPA", ref: "Cal. Civ. Code 1798.120", text: "Consumers can opt out of sale or sharing; a 'Do Not Sell or Share' link is required." },
  SOC2_P1: { regime: "SOC2", ref: "TSC P1.1", text: "The entity provides notice about its privacy practices that matches how it collects, uses, retains and discloses personal information." },
  SOC2_P2: { regime: "SOC2", ref: "TSC P2.1", text: "Choices about collection, use and disclosure are communicated and consent is obtained." },
  SOC2_P3: { regime: "SOC2", ref: "TSC P3.1", text: "Personal information is collected only for the purposes identified in the notice." },
  SOC2_P4: { regime: "SOC2", ref: "TSC P4.3", text: "Personal information is disposed of securely once no longer needed." },
  SOC2_C1: { regime: "SOC2", ref: "TSC C1.1, C1.2", text: "Confidential information is protected and disposed of as committed to customers." },
  SOC2_CC2: { regime: "SOC2", ref: "TSC CC2.3", text: "Commitments to external parties are communicated consistently." },
  SOC2_CC6: { regime: "SOC2", ref: "TSC CC6.1", text: "Logical access to information assets is restricted, including protection of credentials." },
  SOC2_CC7: { regime: "SOC2", ref: "TSC CC7.2", text: "System components are monitored without exposing confidential data in logs." },
  SOC2_CC8: { regime: "SOC2", ref: "TSC CC8.1", text: "Changes are authorised, tested and approved before release." },
  SOC2_CC9: { regime: "SOC2", ref: "TSC CC9.2", text: "Risks from vendors and business partners are assessed and managed." },
} satisfies Record<string, LawRef>;

type RuleOut = Omit<Gap, "frameworks" | "law" | "checklistIds"> & {
  law: Partial<Record<Framework, LawRef[]>>;
  checklist: Partial<Record<Framework, string[]>>;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const label = (d: string) => DATA_TYPE_LABEL[d] ?? d;
const ev = (f: { file: string; line: number; snippet?: string; table?: string }) => ({ file: f.file, line: f.line, snippet: f.snippet, table: f.table });

function claimed(claims: PolicyClaims, dataType: string): boolean {
  return claims.collected.some((c) => c.toLowerCase() === dataType || classifyText(c).includes(dataType) || c.toLowerCase().replace(/\s+/g, "_") === dataType);
}

function disclosedVendor(claims: PolicyClaims, vendor: string): boolean {
  const v = vendor.toLowerCase();
  const first = v.split(/[\s(]/)[0];
  return claims.thirdParties.some((t) => { const x = t.toLowerCase(); return x.includes(first) || v.includes(x); });
}

/** Deterministic rules -> Gap[], only for the project's frameworks. Gap ids are stable across scans. */
export function runEngine(input: EngineInput): Gap[] {
  const { frameworks, codeFindings, schemaFindings, claims } = input;
  const db = input.dbFindings ?? [];
  const signals: EngineSignals = { consentCaptured: false, doNotSellLink: false, hasRetentionJob: false, ...input.signals };
  const out: RuleOut[] = [];
  const policyWord = claims.noPolicy ? "no privacy policy" : "the privacy policy";

  // Rule 8: no policy at all -> one high gap per framework
  if (claims.noPolicy) {
    const per: Record<Framework, [LawRef[], string[]]> = {
      DPDP: [[LAW.DPDP_5], ["dpdp_notice_items", "dpdp_notice_purposes", "dpdp_consent"]],
      GDPR: [[LAW.GDPR_13, LAW.GDPR_6], ["gdpr_lawful_basis", "gdpr_categories"]],
      CCPA: [[LAW.CCPA_100], ["ccpa_notice"]],
      SOC2: [[LAW.SOC2_P1], ["soc2_privacy_notice"]],
    };
    for (const fw of frameworks) {
      out.push({ id: `no_policy:${fw.toLowerCase()}`, severity: "high", title: `No privacy notice found (${fw} requires one before processing)`, layer: "policy_vs_code",
        evidence: [], law: { [fw]: per[fw][0] }, checklist: { [fw]: per[fw][1] },
        fix: "Publish a privacy notice listing what you collect, why, who receives it and how long you keep it, and link it at sign-up. TriLens can draft one from this scan." });
    }
  }

  // Rule 1: data type in code/schema not in `collected`
  const typeEvidence = new Map<string, Gap["evidence"]>();
  const addType = (d: string, e: Gap["evidence"][number]) => {
    const list = typeEvidence.get(d) ?? [];
    if (list.length < 4 && !list.some((x) => x.file === e.file && x.table === e.table)) list.push(e);
    typeEvidence.set(d, list);
  };
  for (const f of codeFindings) if (f.kind !== "third_party") for (const d of f.dataTypes) addType(d, ev(f));
  for (const f of schemaFindings) if (f.kind === "pii_column" || f.kind === "vector_store") for (const d of f.dataTypes) addType(d, { file: f.file, line: f.line, table: f.column ? `${f.table}.${f.column}` : f.table });
  for (const [d, evidence] of typeEvidence) {
    if (claimed(claims, d)) continue;
    const sensitive = ["chat_history", "aadhaar", "pan", "payment", "location", "phone"].includes(d);
    out.push({ id: `undisclosed_data:${d}`, severity: sensitive ? "high" : "medium", title: `Collects ${label(d)} but ${policyWord} doesn't mention it`,
      layer: evidence.some((e) => e.table) && !evidence.some((e) => !e.table) ? "policy_vs_storage" : "policy_vs_code", evidence,
      law: { DPDP: [LAW.DPDP_5], GDPR: [LAW.GDPR_13], CCPA: [LAW.CCPA_100], SOC2: [LAW.SOC2_P1] },
      checklist: { DPDP: ["dpdp_notice_items", "dpdp_notice_purposes"], GDPR: ["gdpr_categories", "gdpr_lawful_basis"], CCPA: ["ccpa_notice"], SOC2: ["soc2_privacy_notice"] },
      fix: `Add "${label(d)}" to the data you collect in your notice, with its purpose and lawful basis, or stop collecting it.` });
  }

  // Vendors in code
  const vendors = new Map<string, { sdk: (typeof SDK_CATALOG)[number]; findings: CodeFinding[] }>();
  for (const f of codeFindings) {
    if ((f.kind !== "third_party" && f.kind !== "llm_call") || !f.vendor) continue;
    const sdk = SDK_CATALOG.find((e) => e.vendor === f.vendor);
    if (!sdk || !sdk.thirdParty) continue;
    const v = vendors.get(sdk.id) ?? { sdk, findings: [] };
    v.findings.push(f);
    vendors.set(sdk.id, v);
  }

  for (const [id, { sdk, findings }] of vendors) {
    const evidence = findings.filter((f, i, a) => a.findIndex((x) => x.file === f.file) === i).slice(0, 3).map(ev);
    const types = [...new Set(findings.flatMap((f) => f.dataTypes))];
    // Rule 2: third party not disclosed
    if (!disclosedVendor(claims, sdk.vendor)) {
      out.push({ id: `undisclosed_vendor:${id}`, severity: sdk.category === "llm" || sdk.category === "analytics" ? "high" : "medium",
        title: `${sdk.vendor} receives user data (${types.map(label).join(", ") || "usage data"}) but isn't disclosed`, layer: "policy_vs_code", evidence,
        law: { DPDP: [LAW.DPDP_5, LAW.DPDP_8_2], GDPR: [LAW.GDPR_13_1_E], CCPA: [LAW.CCPA_115], SOC2: [LAW.SOC2_CC9, LAW.SOC2_P1] },
        checklist: { DPDP: ["dpdp_third_parties"], GDPR: ["gdpr_categories"], CCPA: ["ccpa_third_parties"], SOC2: ["soc2_vendor_mgmt", "soc2_privacy_notice"] },
        fix: `Name ${sdk.vendor} as a processor in your notice, saying what it receives (${types.map(label).join(", ") || "usage data"}) and why.` });
    }
    // Rule 4: cross-border without a transfer statement
    if ((sdk.region === "us" || sdk.region === "unknown") && !claims.crossBorder) {
      out.push({ id: `cross_border:${id}`, severity: "medium", title: `Data goes to ${sdk.vendor} (${sdk.region === "us" ? "US" : "region unknown"}) with no transfer disclosure`,
        layer: "policy_vs_code", evidence: evidence.slice(0, 1),
        law: { DPDP: [LAW.DPDP_16], GDPR: [LAW.GDPR_44], SOC2: [LAW.SOC2_CC9] }, checklist: { DPDP: ["dpdp_transfers"], GDPR: ["gdpr_transfers"], SOC2: ["soc2_vendor_mgmt"] },
        fix: `Add a "Where your data is processed" section naming ${sdk.region === "us" ? "the United States" : "the countries"} for ${sdk.vendor}, and the safeguard used (SCCs / DPA).` });
    }
    // Rule 7: analytics/ad SDKs sharing device/IP -> CCPA do-not-sell-or-share
    if ((sdk.category === "analytics" || sdk.category === "ads") && types.some((t) => t === "ip" || t === "device") && !signals.doNotSellLink) {
      out.push({ id: `ccpa_sale_share:${id}`, severity: "medium", title: `${sdk.vendor} shares device/IP data: "Do Not Sell or Share" link required`,
        layer: "policy_vs_code", evidence: evidence.slice(0, 1), law: { CCPA: [LAW.CCPA_120, LAW.CCPA_115] }, checklist: { CCPA: ["ccpa_opt_out"] },
        fix: `Add a "Do Not Sell or Share My Personal Information" link that turns off ${sdk.vendor} for that visitor.` });
    }
  }

  // Rule 3: LLM call receiving chat history or PII
  const llmByVendor = new Map<string, CodeFinding[]>();
  for (const f of codeFindings) if (f.kind === "llm_call" && f.dataTypes.length) llmByVendor.set(f.vendor ?? "LLM", [...(llmByVendor.get(f.vendor ?? "LLM") ?? []), f]);
  for (const [vendor, fs] of llmByVendor) {
    const types = [...new Set(fs.flatMap((f) => f.dataTypes))];
    const history = types.includes("chat_history");
    out.push({ id: `llm_minimisation:${slug(vendor)}`, severity: "high",
      title: history ? `Full chat history${types.length > 1 ? " and personal data" : ""} sent to ${vendor} on every call` : `Personal data (${types.map(label).join(", ")}) sent to ${vendor}`,
      layer: "policy_vs_code", evidence: fs.slice(0, 3).map(ev),
      law: { DPDP: [LAW.DPDP_6], GDPR: [LAW.GDPR_5_1_B, LAW.GDPR_5_1_C], SOC2: [LAW.SOC2_P3, LAW.SOC2_C1] }, checklist: { DPDP: ["dpdp_ai_purpose"], GDPR: ["gdpr_minimisation_ai"], SOC2: ["soc2_minimisation"] },
      fix: `Send ${vendor} only the current message (or a short window), strip phone/email/IP before the call, and disclose ${vendor} and this purpose in the notice.` });
  }

  // Rule 5: PII tables with no deletion path / no TTL
  for (const f of schemaFindings) {
    const loc = { file: f.file, line: f.line, table: f.table };
    if (f.kind === "no_delete_path") {
      out.push({ id: `no_delete_path:${slug(f.table)}`, severity: "high", title: `No deletion path for personal data in ${f.table} (${f.dataTypes.map(label).join(", ")})`,
        layer: "code_vs_storage", evidence: [loc],
        law: { DPDP: [LAW.DPDP_8_7], GDPR: [LAW.GDPR_17], CCPA: [LAW.CCPA_105], SOC2: [LAW.SOC2_P4] },
        checklist: { DPDP: ["dpdp_erasure"], GDPR: ["gdpr_erasure"], CCPA: ["ccpa_deletion"], SOC2: ["soc2_disposal"] },
        fix: `Add a delete-account / delete-my-data handler that removes the user's rows from ${f.table}.` });
    }
    if (f.kind === "no_ttl" && !signals.hasRetentionJob) {
      out.push({ id: `no_ttl:${slug(f.table)}`, severity: "medium", title: `${f.table} keeps personal data forever (no TTL or cleanup job)`,
        layer: "code_vs_storage", evidence: [loc],
        law: { DPDP: [LAW.DPDP_8_7], GDPR: [LAW.GDPR_5_1_E], CCPA: [LAW.CCPA_100_A3], SOC2: [LAW.SOC2_P4] },
        checklist: { DPDP: ["dpdp_erasure"], GDPR: ["gdpr_retention"], CCPA: ["ccpa_retention"], SOC2: ["soc2_disposal"] },
        fix: `Pick a retention period for ${f.table} and enforce it with a scheduled delete (e.g. pg_cron: DELETE FROM ${f.table} WHERE created_at < now() - interval '1 year').` });
    }
  }

  // Retention not stated in the policy (only when the policy exists; noPolicy already covers it)
  const hasPii = typeEvidence.size > 0;
  if (!claims.noPolicy && !claims.retention && hasPii) {
    out.push({ id: "retention_not_stated", severity: "medium", title: "Privacy policy doesn't say how long personal data is kept",
      layer: "policy_vs_storage", evidence: [],
      law: { GDPR: [LAW.GDPR_5_1_E, LAW.GDPR_13], CCPA: [LAW.CCPA_100_A3] },
      checklist: { GDPR: ["gdpr_retention"], CCPA: ["ccpa_retention"] },
      fix: "State a retention period for each data category (e.g. chat logs 90 days, account data until deletion)." });
  }

  // Rule 6: vector store holding user text
  const vectorTables = schemaFindings.filter((f) => f.kind === "vector_store");
  const vectorVendors = [...vendors.values()].filter((v) => v.sdk.category === "vector");
  for (const f of vectorTables) {
    out.push({ id: `vector_store:${slug(f.table)}`, severity: "high", title: `Embeddings of user text in ${f.table} are personal data but aren't in the notice or deletion path`,
      layer: "policy_vs_storage", evidence: [{ file: f.file, line: f.line, table: `${f.table}${f.column ? "." + f.column : ""}` }],
      law: { DPDP: [LAW.DPDP_5, LAW.DPDP_8_7], GDPR: [LAW.GDPR_13, LAW.GDPR_17], CCPA: [LAW.CCPA_105], SOC2: [LAW.SOC2_P4] },
      checklist: { DPDP: ["dpdp_notice_items", "dpdp_erasure"], GDPR: ["gdpr_categories", "gdpr_erasure"], CCPA: ["ccpa_deletion"], SOC2: ["soc2_disposal"] },
      fix: `List "embeddings of your messages" in the notice and delete a user's rows from ${f.table} when they delete their account.` });
  }
  for (const v of vectorVendors) {
    out.push({ id: `vector_store:${v.sdk.id}`, severity: "high", title: `Embeddings of user text stored in ${v.sdk.vendor} need notice and deletion`,
      layer: "policy_vs_storage", evidence: v.findings.slice(0, 1).map(ev),
      law: { DPDP: [LAW.DPDP_5, LAW.DPDP_8_7], GDPR: [LAW.GDPR_13, LAW.GDPR_17], CCPA: [LAW.CCPA_105], SOC2: [LAW.SOC2_P4] },
      checklist: { DPDP: ["dpdp_notice_items", "dpdp_erasure"], GDPR: ["gdpr_categories", "gdpr_erasure"], CCPA: ["ccpa_deletion"], SOC2: ["soc2_disposal"] },
      fix: `Delete the user's vectors from ${v.sdk.vendor} (by user id metadata) in your delete-account path, and disclose it.` });
  }

  // Consent before processing (DPDP s.6)
  if (!signals.consentCaptured && hasPii) {
    out.push({ id: "no_consent_capture", severity: "high", title: "No consent capture found before personal data is processed",
      layer: "policy_vs_code", evidence: [],
      law: { DPDP: [LAW.DPDP_6], GDPR: [LAW.GDPR_6], SOC2: [LAW.SOC2_P2] }, checklist: { DPDP: ["dpdp_consent"], GDPR: ["gdpr_lawful_basis"], SOC2: ["soc2_consent"] },
      fix: "Show the notice with an unticked consent checkbox at sign-up and store who consented, when, and to which notice version." });
  }

  // Purposes not stated
  if (!claims.noPolicy && claims.purposes.length === 0 && hasPii) {
    out.push({ id: "purposes_not_stated", severity: "medium", title: "Privacy policy doesn't state purposes of processing", layer: "policy_vs_code", evidence: [],
      law: { DPDP: [LAW.DPDP_5], GDPR: [LAW.GDPR_6, LAW.GDPR_13] }, checklist: { DPDP: ["dpdp_notice_purposes"], GDPR: ["gdpr_lawful_basis"] },
      fix: "For each data item, state why you collect it and the lawful basis." });
  }

  // Rule 9: live DB findings (T9)
  for (const f of db) {
    if (f.kind === "broad_read_access" || f.kind === "rls_off") {
      out.push({ id: `db_${f.kind}:${slug(f.table)}`, severity: "high",
        title: f.kind === "rls_off" ? `Row-level security is off on ${f.table}` : `${(f.roles ?? []).join(", ") || "Broad roles"} can read ${f.table}${f.column ? "." + f.column : ""}`,
        layer: "storage_access", evidence: [{ table: f.column ? `${f.table}.${f.column}` : f.table, snippet: f.detail }],
        law: { DPDP: [LAW.DPDP_8_5], GDPR: [LAW.GDPR_32], SOC2: [LAW.SOC2_CC6] }, checklist: { DPDP: ["dpdp_security"], GDPR: ["gdpr_security"], SOC2: ["soc2_access_control"] },
        fix: f.kind === "rls_off" ? `ALTER TABLE ${f.table} ENABLE ROW LEVEL SECURITY; then add policies limiting each user to their own rows.` : `REVOKE SELECT ON ${f.table} FROM anon, authenticated, PUBLIC; grant reads only to the roles that need them.` });
    } else if (f.kind === "no_ttl" && !schemaFindings.some((s) => s.kind === "no_ttl" && slug(s.table) === slug(f.table))) {
      out.push({ id: `no_ttl:${slug(f.table)}`, severity: "medium", title: `${f.table} keeps personal data forever (no TTL job in the database)`,
        layer: "storage_access", evidence: [{ table: f.table, snippet: f.detail }],
        law: { DPDP: [LAW.DPDP_8_7], GDPR: [LAW.GDPR_5_1_E], CCPA: [LAW.CCPA_100_A3], SOC2: [LAW.SOC2_P4] },
        checklist: { DPDP: ["dpdp_erasure"], GDPR: ["gdpr_retention"], CCPA: ["ccpa_retention"], SOC2: ["soc2_disposal"] },
        fix: `Schedule a delete on ${f.table} for rows older than your stated retention period.` });
    } else if (f.kind === "pii_column") {
      // Already disclosed in the policy: the column is personal data, but not a gap.
      if (f.dataTypes?.length && !claims.noPolicy && f.dataTypes.every((d) => claimed(claims, d))) continue;
      out.push({ id: `db_pii_column:${slug(f.table)}_${slug(f.column ?? "")}`, severity: "medium", title: `Personal data found in ${f.table}${f.column ? "." + f.column : ""}`,
        layer: "policy_vs_storage", evidence: [{ table: f.column ? `${f.table}.${f.column}` : f.table, snippet: f.detail }],
        law: { DPDP: [LAW.DPDP_5], GDPR: [LAW.GDPR_13], CCPA: [LAW.CCPA_100] },
        checklist: { DPDP: ["dpdp_notice_items"], GDPR: ["gdpr_categories"], CCPA: ["ccpa_notice"] },
        fix: `Disclose what ${f.column ?? "this column"} holds in the notice, or stop storing it there.` });
    }
  }

  // SOC 2 repository controls: committed secrets, personal data in logs, no CI/tests.
  for (const sec of (signals.secrets ?? []).slice(0, 5)) {
    out.push({ id: `secret_in_repo:${slug(sec.file)}_${sec.line}`, severity: "high", title: `${sec.kind} committed to the repository`,
      layer: "repo_hygiene", evidence: [{ file: sec.file, line: sec.line }],
      law: { SOC2: [LAW.SOC2_CC6], DPDP: [LAW.DPDP_8_5], GDPR: [LAW.GDPR_32] },
      checklist: { SOC2: ["soc2_secrets"], DPDP: ["dpdp_security"], GDPR: ["gdpr_security"] },
      fix: "Remove it from the repo (and its git history), rotate the key now, and load it from an environment variable or secrets manager." });
  }
  const piiLogs = codeFindings.filter((f) => f.kind === "logging" && f.dataTypes.length);
  if (piiLogs.length) {
    out.push({ id: "pii_in_logs", severity: "medium", title: `Personal data written to logs (${[...new Set(piiLogs.flatMap((f) => f.dataTypes))].map(label).join(", ")})`,
      layer: "repo_hygiene", evidence: piiLogs.slice(0, 3).map(ev),
      law: { SOC2: [LAW.SOC2_C1, LAW.SOC2_CC7], GDPR: [LAW.GDPR_5_1_C] }, checklist: { SOC2: ["soc2_logging"], GDPR: ["gdpr_minimisation_ai"] },
      fix: "Log user ids and event names instead of request bodies or user records, and mask emails, phones and tokens." });
  }
  if (signals.hasCi === false || signals.hasTests === false) {
    const missing = [signals.hasCi === false ? "a CI workflow" : "", signals.hasTests === false ? "automated tests" : ""].filter(Boolean).join(" or ");
    out.push({ id: "no_change_control", severity: "low", title: `No ${missing} found: changes reach production unchecked`,
      layer: "repo_hygiene", evidence: [], law: { SOC2: [LAW.SOC2_CC8] }, checklist: { SOC2: ["soc2_change_mgmt"] },
      fix: "Add a CI workflow (e.g. .github/workflows/ci.yml) that runs tests on every pull request, and require it to pass before merging." });
  }

  // Legal documents vs code: a document promises deletion or a retention period but nothing deletes data.
  const promises = input.docPromises ?? [];
  const hasStoredPii = schemaFindings.some((f) => f.kind === "pii_column" || f.kind === "vector_store") || typeEvidence.size > 0;
  for (const pr of promises.filter((x) => (x.kind === "retention" || x.kind === "deletion") && hasStoredPii && !signals.hasRetentionJob).slice(0, 3)) {
    out.push({ id: `doc_promise_unenforced:${slug(pr.doc)}`, severity: "high", title: `${pr.doc} promises "${pr.text.slice(0, 90)}" but the code never deletes data`,
      layer: "policy_vs_storage", evidence: schemaFindings.filter((f) => f.kind === "no_ttl" || f.kind === "no_delete_path").slice(0, 2).map((f) => ({ file: f.file, line: f.line, table: f.table })),
      law: { DPDP: [LAW.DPDP_8_7], GDPR: [LAW.GDPR_5_1_E], CCPA: [LAW.CCPA_100_A3], SOC2: [LAW.SOC2_C1, LAW.SOC2_P4] },
      checklist: { DPDP: ["dpdp_erasure"], GDPR: ["gdpr_retention"], CCPA: ["ccpa_retention"], SOC2: ["soc2_disposal", "soc2_documents_consistent"] },
      fix: `Add a scheduled delete that matches what ${pr.doc} promises, or change the document to what the system really does.` });
  }
  for (const pr of promises.filter((x) => x.kind === "no_sharing" && vendors.size > 0).slice(0, 2)) {
    const names = [...vendors.values()].map((v) => v.sdk.vendor).slice(0, 4).join(", ");
    out.push({ id: `doc_promise_sharing:${slug(pr.doc)}`, severity: "high", title: `${pr.doc} says data isn't shared, but the code sends it to ${names}`,
      layer: "policy_vs_code", evidence: [...vendors.values()].flatMap((v) => v.findings.slice(0, 1)).slice(0, 3).map(ev),
      law: { DPDP: [LAW.DPDP_5, LAW.DPDP_8_2], GDPR: [LAW.GDPR_13_1_E], CCPA: [LAW.CCPA_115], SOC2: [LAW.SOC2_CC2, LAW.SOC2_C1] },
      checklist: { DPDP: ["dpdp_third_parties"], GDPR: ["gdpr_categories"], CCPA: ["ccpa_third_parties"], SOC2: ["soc2_documents_consistent", "soc2_vendor_mgmt"] },
      fix: `Name these processors in ${pr.doc} (as subprocessors bound by confidentiality), or stop sending them the data.` });
  }
  // Legal documents vs each other (found by the agent when the scan reads all documents together).
  for (const [i, c] of (input.docConflicts ?? []).slice(0, 6).entries()) {
    out.push({ id: `doc_conflict:${i}_${slug(c.title).slice(0, 40)}`, severity: c.severity, title: c.title,
      layer: "doc_vs_doc", evidence: [{ snippet: `${c.docs.join(" vs ")}: ${c.detail}` }],
      law: { DPDP: [LAW.DPDP_5], GDPR: [LAW.GDPR_13], CCPA: [LAW.CCPA_100], SOC2: [LAW.SOC2_CC2] },
      checklist: { DPDP: ["dpdp_notice_purposes"], GDPR: ["gdpr_categories"], CCPA: ["ccpa_notice"], SOC2: ["soc2_documents_consistent"] },
      fix: `Make ${c.docs.join(" and ")} say the same thing, matching what the system actually does.` });
  }

  // Keep only selected frameworks; drop gaps that apply to none of them. De-dup by id.
  const gaps: Gap[] = [];
  const seen = new Set<string>();
  for (const r of out) {
    if (seen.has(r.id)) continue;
    const fws = frameworks.filter((fw) => r.law[fw]?.length || r.checklist[fw]?.length);
    if (!fws.length) continue;
    seen.add(r.id);
    const { law, checklist, ...rest } = r;
    gaps.push({ ...rest, frameworks: fws, law: fws.flatMap((fw) => law[fw] ?? []), checklistIds: fws.flatMap((fw) => checklist[fw] ?? []) });
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return gaps.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
