import { AgenticOrg } from "agenticorg-sdk";
import { withInstructions } from "./agent/instructions";

// Every AI step goes through AgenticOrg agents (no Claude API key today).
// Callers must always have a deterministic fallback: these helpers return null on any failure or timeout.

let client: AgenticOrg | null = null;

export function agenticorg(): AgenticOrg | null {
  if (!process.env.AGENTICORG_API_KEY) return null;
  if (!client) {
    // baseUrl matters: the SDK defaults to app.agenticorg.ai, not the hackathon tenant
    client = new AgenticOrg({
      apiKey: process.env.AGENTICORG_API_KEY,
      baseUrl: process.env.AGENTICORG_BASE_URL ?? "https://agenticorg.hackathon.pinelabs.com",
    });
  }
  return client;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

export type AgentRun = {
  run_id?: string;
  status?: string;
  output?: unknown;
  hitl_trigger?: unknown;
  error?: unknown;
};

export async function runAgent(
  agentId: string | undefined,
  action: string,
  inputs: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<AgentRun | null> {
  const c = agenticorg();
  if (!c || !agentId) return null;
  try {
    const res = await withTimeout(
      (c as unknown as { agents: { run: (id: string, body: unknown) => Promise<AgentRun> } }).agents.run(agentId, { action, inputs: withInstructions(action, inputs) }),
      timeoutMs,
    );
    return res;
  } catch (err) {
    console.error("agent run failed", action, (err as Error).message);
    return null;
  }
}

// Agents sometimes wrap JSON in prose or code fences; pull the first JSON object out.
export function parseJsonOutput(output: unknown): unknown {
  if (output && typeof output === "object") return output;
  if (typeof output !== "string") return null;
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1] : output;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
