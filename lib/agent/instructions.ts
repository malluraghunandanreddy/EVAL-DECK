// Per-action instructions sent to the AgenticOrg agents on every run as `inputs.instructions`.
// The hackathon tenant rejects agent create/update bodies over ~500 chars, so the agents carry a short
// system prompt ("follow inputs.instructions exactly, reply with ONLY the JSON described") and the
// detailed contract lives here instead. Keep each block self-contained: the agent sees nothing else.

const CLAIMS_JSON = `{
  "collected": string[],      // personal data items the policy says are collected, lower-case short names
                              // e.g. "email", "phone", "name", "ip", "address", "device", "chat_history", "location", "payment"
  "purposes": string[],       // stated purposes, short phrases
  "thirdParties": string[],   // named vendors or categories of recipients ("analytics providers"); [] if it says it never shares
  "retention": string | null, // stated retention period, verbatim-ish, or null
  "crossBorder": string | null, // statement about transfers outside the user's country, or null
  "noPolicy": boolean         // true only if the text is not a privacy policy at all
}`;

const POLICY_RULES = `You are the drafting step of a tool. A human reviewer reads and approves your draft before anything is published, so do not
escalate, refuse or ask for attorney review: produce the draft. Include the line "Not legal advice" in both documents.
Rules:
1. Draft only from the given report and frameworks. baseline_policy_md is a correct deterministic draft; improve
   its wording and structure, do not drop any data item, vendor or right it lists.
2. Never claim the app "is compliant" or "fully complies". Say what the app does.
3. Only remove a claim from the existing policy when the scan proves it false (e.g. "we never share data"
   while OpenAI receives chat history).
4. Use "##" headings, one per section. Include framework sections only for the given frameworks:
   - DPDP (India): notice items, purpose per item, consent and consent withdrawal, grievance officer,
     right to complain to the Data Protection Board of India, children (verifiable parental consent under 18).
   - GDPR (EU/UK): lawful basis per purpose (table), data subject rights, international transfers
     (SCCs/adequacy), DPO or privacy contact.
   - CCPA (US): categories collected, sources, "Do Not Sell or Share" (needed if analytics/ad SDKs are present),
     right to know and delete, retention per category.
5. Use placeholders for unknown company details: [Company name], [Contact email], [Grievance officer name],
   [Retention period], [Jurisdiction].
6. Keep the line "Not legal advice" in both documents.
7. summary: plain English, under 120 words, what changed and what the owner must still do in code.

Return ONLY JSON, no prose, no code fences:
{ "policy_md": string, "terms_md": string, "summary": string }`;

export const INSTRUCTIONS: Record<string, string> = {
  extract_claims: `Action "extract_claims". Extract structured claims from the website privacy policy in inputs.policy_text.
Read only the given text. Do not guess or add anything the text does not say.
Return ONLY a JSON object, no prose, no code fences:
${CLAIMS_JSON}`,

  summarise_findings: `Action "summarise_findings". inputs.findings is a list of compliance findings.
Return ONLY { "summaries": [{ "index": number, "summary": string }] } with one plain-English line (max 20 words) per finding.`,

  extract_doc_promises: `Action "extract_doc_promises". inputs.document_text is a legal document (privacy policy, terms, engagement
terms, NDA or DPA) called inputs.document_title. List every concrete promise it makes about data or confidential information.
Only these kinds: "retention" (how long data is kept), "deletion" (when or how data is deleted or returned), "sharing"
(data IS shared with or disclosed to named recipients or categories such as hosting, analytics or AI providers), "no_sharing"
(data is not shared, sold or disclosed to third parties), "confidentiality" (who may access confidential or client information),
"storage_location" (where data is stored or processed). Quote or closely paraphrase the document; do not invent promises.
Return ONLY { "promises": [{ "kind": string, "text": string }] } with at most 12 items, no prose, no code fences.`,

  compare_documents: `Action "compare_documents". inputs.documents lists several legal documents from the same company, each with the
data promises it makes. The documents cover the same product, so customer or client data handled by the product falls under all
of them. Find places where two documents contradict each other: different retention or deletion periods for data that could be
the same (for example account data kept 12 months vs client information destroyed within 30 days), one document says data or
confidential information is never disclosed to third parties while another shares it with providers (hosting, analytics, AI),
different storage locations, or confidentiality terms that the other document breaks. Ignore differences in wording that mean
the same thing. Do not report a document for missing a topic.
severity: "high" if a customer could be misled about sharing or deletion, else "medium"; "low" for minor wording.
Return ONLY { "conflicts": [{ "title": string, "docs": [string, string], "detail": string, "severity": string }] }
with at most 6 items. title is one plain sentence naming both documents. Return { "conflicts": [] } if they agree.`,

  draft_policy: `Action "draft_policy". Draft a privacy policy and terms of service from the automated scan report in inputs:
{ scan_id, policy_version_id, app_name, frameworks, markets, gaps (with fixes), code_findings, schema_findings,
  db_findings, policy_claims, existing_policy_md, baseline_policy_md, baseline_terms_md }.
${POLICY_RULES}`,

  update_policy: `Action "update_policy". Update an existing privacy policy after the app's repo changed. inputs has the same
report fields as draft_policy plus { previous_policy_md, new_gaps, removed_gaps }. Change only what the new or
removed gaps require; keep everything else in previous_policy_md as it is.
${POLICY_RULES}`,
};

/** Adds the action's instructions to the run inputs (no-op for unknown actions). */
export function withInstructions(action: string, inputs: Record<string, unknown>): Record<string, unknown> {
  const instructions = INSTRUCTIONS[action];
  return instructions ? { instructions, ...inputs } : inputs;
}
