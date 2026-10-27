import Anthropic from "@anthropic-ai/sdk";
import { withInstructions } from "./instructions";
import type { AgentRun } from "../ai";

// TriLens' own agent: the same actions and JSON contracts as the AgenticOrg agents (see instructions.ts),
// answered by Claude Haiku. Needs ANTHROPIC_API_KEY. A human still approves every draft before it is published.

const MODEL = process.env.TRILENS_AGENT_MODEL ?? "claude-haiku-5-5";

const SYSTEM =
  "You are the TriLens compliance agent. Follow inputs.instructions exactly. " +
  "Reply with ONLY the JSON object it describes: no prose, no code fences.";

// Drafting needs more room and thought than extraction.
const PROFILE: Record<string, { effort: "low" | "medium"; maxTokens: number }> = {
  extract_claims: { effort: "low", maxTokens: 4_000 },
  summarise_findings: { effort: "low", maxTokens: 4_000 },
  extract_doc_promises: { effort: "low", maxTokens: 4_000 },
  compare_documents: { effort: "medium", maxTokens: 6_000 },
  draft_policy: { effort: "medium", maxTokens: 16_000 },
  update_policy: { effort: "medium", maxTokens: 16_000 },
};

let client: Anthropic | null = null;

/** The own agent runs whenever an Anthropic key is set, unless AGENT_PROVIDER=agenticorg forces the old path. */
export function ownAgentEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.AGENT_PROVIDER !== "agenticorg";
}

function parseJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runOwnAgent(action: string, inputs: Record<string, unknown>, timeoutMs: number): Promise<AgentRun | null> {
  if (!ownAgentEnabled()) return null;
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const profile = PROFILE[action] ?? { effort: "low" as const, maxTokens: 4_000 };
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ tag: "trilens_agent", event, action, model: MODEL, ms: Date.now() - started, ...extra }));
  log("run_start", { inputBytes: JSON.stringify(inputs).length });
  try {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: profile.maxTokens,
        system: SYSTEM,
        output_config: { effort: profile.effort },
        messages: [{ role: "user", content: JSON.stringify(withInstructions(action, inputs)) }],
      },
      { signal: abort.signal },
    );
    const msg = await stream.finalMessage();
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const runId = `trilens_${msg.id}`;
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
      log("run_failed", { stop: msg.stop_reason });
      return { run_id: runId, status: "failed", error: `model stopped: ${msg.stop_reason}` };
    }
    const output = parseJson(text);
    if (!output) {
      log("run_failed", { stop: msg.stop_reason, reason: "no JSON in reply" });
      return { run_id: runId, status: "failed", error: "reply was not JSON" };
    }
    log("run_done", { runId, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens, outputKeys: Object.keys(output).slice(0, 8) });
    return { run_id: runId, status: "completed", output };
  } catch (err) {
    log("run_error", { error: (err as Error).message.slice(0, 300) });
    return null; // callers fall back to the deterministic draft
  } finally {
    clearTimeout(timer);
  }
}
