/**
 * Smoke-test the AgenticOrg agents with tiny inputs.
 *   npx tsx scripts/agent-smoke.ts             # reader + reviewer agents
 *   npx tsx scripts/agent-smoke.ts --workflow  # also start one workflow run (creates an item in Approvals)
 *   npx tsx scripts/agent-smoke.ts --run <id>  # print workflows.getRun(<id>) (check status after approving)
 * Reads .env.local / .env if present, then process.env. Prints status and output only, never the key.
 */
import { existsSync, readFileSync } from "node:fs";
import { AgenticOrg } from "agenticorg-sdk";
import { withInstructions } from "../lib/agent/instructions";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const apiKey = process.env.AGENTICORG_API_KEY;
const baseUrl = process.env.AGENTICORG_BASE_URL ?? "https://agenticorg.hackathon.pinelabs.com";
if (!apiKey) {
  console.error("AGENTICORG_API_KEY is not set");
  process.exit(1);
}
const client = new AgenticOrg({ apiKey, baseUrl, timeout: 120_000 });
console.log(`AgenticOrg at ${baseUrl}`);

const sampleGaps = [
  {
    id: "vendor_undisclosed:openai", severity: "high", title: "OpenAI receives chat history but is not in the policy",
    layer: "policy_vs_code", frameworks: ["DPDP", "GDPR"],
    evidence: [{ file: "src/chat.ts", line: 12, snippet: "openai.chat.completions.create({ messages: history })" }],
    law: [{ regime: "DPDP", ref: "s.5", text: "Notice must list personal data and purpose" }],
    fix: "Disclose OpenAI as a processor and send only the current message.",
  },
];

function show(label: string, res: unknown) {
  const r = res as Record<string, unknown>;
  console.log(`\n=== ${label} ===`);
  console.log("status:", r?.status, "| run_id:", r?.run_id ?? r?.id, "| hitl_trigger:", r?.hitl_trigger ?? null, "| error:", r?.error ?? null);
  const out = JSON.stringify(r?.output ?? r, null, 2);
  console.log("output:", out.length > 3000 ? out.slice(0, 3000) + "\n... (truncated)" : out);
}

async function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  if (runIdx >= 0) {
    show(`workflows.getRun(${args[runIdx + 1]})`, await client.workflows.getRun(args[runIdx + 1]));
    return;
  }

  const reader = process.env.AGENTICORG_READER_AGENT_ID;
  if (reader) {
    try {
      const t = Date.now();
      const res = await client.agents.run(reader, {
        action: "extract_claims",
        inputs: withInstructions("extract_claims", { policy_text: "We only collect your name and email for authentication. We never share data with third parties. We keep data for 1 year." }),
      });
      show(`Policy Reader (${Date.now() - t} ms)`, res);
    } catch (e) {
      console.error("Policy Reader failed:", (e as Error).message);
    }
  } else console.log("AGENTICORG_READER_AGENT_ID not set, skipping reader");

  const reviewer = process.env.AGENTICORG_REVIEWER_AGENT_ID;
  const inputs = {
    scan_id: "00000000-0000-0000-0000-000000000000",
    policy_version_id: "00000000-0000-0000-0000-000000000000",
    app_name: "Demo Support Bot",
    frameworks: ["DPDP", "GDPR"],
    gaps: sampleGaps,
    code_findings: [{ kind: "llm_call", vendor: "OpenAI", dataTypes: ["chat_history"], file: "src/chat.ts", line: 12, snippet: "", region: "us" }],
    schema_findings: [{ table: "User", column: "phone", dataTypes: ["phone"], kind: "pii_column", file: "prisma/schema.prisma", line: 8 }],
    db_findings: [],
    existing_policy_md: "We only collect name and email for authentication and never share data with third parties.",
    smoke_test: true,
  };
  if (reviewer) {
    try {
      const t = Date.now();
      const res = await client.agents.run(reviewer, { action: "draft_policy", inputs: withInstructions("draft_policy", inputs) });
      show(`Compliance Reviewer (${Date.now() - t} ms)`, res);
    } catch (e) {
      console.error("Compliance Reviewer failed:", (e as Error).message);
    }
  } else console.log("AGENTICORG_REVIEWER_AGENT_ID not set, skipping reviewer");

  const wf = process.env.AGENTICORG_WORKFLOW_ID;
  if (args.includes("--workflow")) {
    if (!wf) console.log("AGENTICORG_WORKFLOW_ID not set, skipping workflow");
    else {
      try {
        const res = await client.workflows.run(wf, { payload: withInstructions("draft_policy", { action: "draft_policy", ...inputs }) });
        show("workflows.run", res);
        const id = (res.run_id ?? res.id) as string | undefined;
        if (id) console.log(`\nApprove it in AgenticOrg (Governance > Approvals), then: npx tsx scripts/agent-smoke.ts --run ${id}`);
      } catch (e) {
        console.error("Workflow run failed:", (e as Error).message);
      }
    }
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
