# AgenticOrg setup for PolicyDrift

Tenant: `https://agenticorg.hackathon.pinelabs.com` (set `AGENTICORG_BASE_URL`; the SDK otherwise defaults to `app.agenticorg.ai`).
All runs go through `agenticorg-sdk@0.4.0` by agent **UUID** (`POST /api/v1/agents/{id}/run`). Running by agent type needs `companyId` + `a2a:write`, which default keys lack.

## 1. Create the Policy Reader agent

Agents -> Create (or Create from SOP). Name: **PolicyDrift Policy Reader**. No tools, no approval gate (it changes nothing).
Copy the UUID from the agent page URL into Vercel as `AGENTICORG_READER_AGENT_ID`.

Prompt (paste as the agent's instructions):

```
You extract structured claims from a website privacy policy. You are called with action "extract_claims"
and inputs { policy_text }. Read only the given text. Do not guess or add anything the text does not say.

Return ONLY a JSON object, no prose, no code fences:
{
  "collected": string[],      // personal data items the policy says are collected, lower-case short names
                              // e.g. "email", "phone", "name", "ip", "address", "device", "chat_history", "location", "payment"
  "purposes": string[],       // stated purposes, short phrases
  "thirdParties": string[],   // named vendors or categories of recipients ("analytics providers")
  "retention": string | null, // stated retention period, verbatim-ish, or null
  "crossBorder": string | null, // statement about transfers outside the user's country, or null
  "noPolicy": boolean         // true only if the text is not a privacy policy at all
}
If the policy says "we never share data with third parties", thirdParties is [].

You may also be called with action "summarise_findings" and inputs { findings }: return ONLY
{ "summaries": [{ "index": number, "summary": string }] } with one plain-English line (max 20 words) per finding.
```

## 2. Create the Compliance Reviewer agent

Name: **PolicyDrift Compliance Reviewer**. Copy its UUID into `AGENTICORG_REVIEWER_AGENT_ID`.
For **Path B** also give it the connector tools below and put **HITL / approval on `publish_policy`**.

Prompt:

```
You are a privacy reviewer for indie apps. You draft privacy policies and terms of service from an
automated scan report. You never see source code, credentials or database rows; only findings.

Actions:
- "draft_policy": inputs { scan_id, policy_version_id, app_name, frameworks, markets, gaps (with fixes),
  code_findings, schema_findings, db_findings, policy_claims, existing_policy_md, baseline_policy_md, baseline_terms_md }
- "update_policy": the same, plus { previous_policy_md, new_gaps, removed_gaps }. Change only what the new or
  removed gaps require; keep everything else in previous_policy_md as it is.

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
{ "policy_md": string, "terms_md": string, "summary": string }

Path B only: after drafting, call save_policy_draft(scan_id, policy_md, terms_md, summary, policy_version_id),
then call publish_policy(policy_version_id). publish_policy requires human approval.
```

## 3. Smoke test (local terminal)

```
cp .env.example .env.local   # fill AGENTICORG_* values
npx tsx scripts/agent-smoke.ts
```
Confirm each agent prints a `status` and an `output` with the JSON above. Note the latency: `/api/scans/:id/fix` waits up to 60 s for the reviewer.

## 4. Pick Path A or Path B (first 20 minutes)

### Path A: workflow (preferred, no inbound connection)
Workflows -> generate or build **"PolicyDrift review"**:
1. Run *PolicyDrift Compliance Reviewer* on the run payload (the payload has `action` plus all inputs above).
2. Human approval step.
3. Finish with the reviewer's output `{ policy_md, terms_md, summary }`.

Try: `workflows.generate("Run PolicyDrift Compliance Reviewer on the payload, require human approval, then finish with the approved draft")` or build it in the UI.
Set `AGENTICORG_WORKFLOW_ID`, then:
```
npx tsx scripts/agent-smoke.ts --workflow     # starts a run, prints run id
# approve it under Governance > Approvals
npx tsx scripts/agent-smoke.ts --run <run_id> # status should change
```
Paste the `--run` output to the app team if the status words differ from: running/pending/waiting_approval (pending),
completed/succeeded/approved (approved), rejected, or failed/cancelled. The app reads `status`, and looks for
`decision|approval_status|outcome: "rejected"` anywhere in the run body, plus `policy_md` anywhere in the output.

With `AGENTICORG_WORKFLOW_ID` set the app uses Path A; each report poll calls `workflows.getRun` at most every 10 s per
pending version and gives up after 30 min (the draft stays pending for `/admin/approvals`).

### Path B: agent + connector callback
Leave `AGENTICORG_WORKFLOW_ID` empty. Connectors (or A2A/MCP) -> add `policydrift-<team>`:
- Base URL `${APP_BASE_URL}/api/agent`, header `Authorization: Bearer <MCP_TOKEN>`.
- Tool `publish_policy`: `POST /publish`, JSON `{ "policy_version_id": "<uuid>", "note"?: string }` (save this one tool first: Save Config bug #1504).
- Tool `save_policy_draft`: `POST /draft`, JSON `{ "scan_id", "policy_md", "terms_md", "summary", "policy_version_id"? }`.
Give both tools to the Compliance Reviewer; set approval (HITL) on `publish_policy`.

## 5. Fallback
If AgenticOrg is down or slow, "Publish my policy" still creates a deterministic draft in `pending_review` (mode `manual`).
Approve it at `/admin/approvals` (ADMIN_PASSWORD). The event log records `approval` with `{ via: "admin" }`.

## 6. Re-review on repo change (demo)
Add a webhook on the demo repo: Payload URL `${APP_BASE_URL}/api/github/webhook`, content type `application/json`,
secret `GITHUB_WEBHOOK_SECRET`, push events only. A push that adds Mixpanel -> re-scan -> new gap -> widget shows
"Out of date, review pending" -> reviewer run with `action: "update_policy"` -> approve -> widget updates.
Without the webhook the report page poll checks the default branch at most once a minute.

## 7. Embed the widget
```html
<div id="policydrift-widget"></div>
<script src="${APP_BASE_URL}/w/<siteId>.js" async></script>
```
Hosted pages: `${APP_BASE_URL}/p/<siteId>` (privacy) and `${APP_BASE_URL}/t/<siteId>` (terms).
