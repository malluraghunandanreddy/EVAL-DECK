import { withInstructions } from "./instructions";
import { and, desc, eq } from "drizzle-orm";
import { db, logEvent, schema } from "../db";
import type { PolicyVersion, Project, Scan } from "../db/schema";
import { agenticorg, parseJsonOutput, runAgent, withTimeout } from "../ai";
import { ensureDisclaimer, generateFromScan } from "../policy/generate";
import { projectFrameworks, scanParts } from "../policy/inventory";

export type ReviewAction = "draft_policy" | "update_policy";
/** workflow = Path A (poll getRun), agent = Path B (agent calls /api/agent/publish), manual = admin approves at /admin/approvals */
export type AgentMode = "workflow" | "agent" | "manual";

export type Site = typeof schema.sites.$inferSelect;

export async function ensureSite(project: Pick<Project, "id" | "name">): Promise<Site> {
  const [existing] = await db.select().from(schema.sites).where(eq(schema.sites.projectId, project.id)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.sites).values({ projectId: project.id, name: project.name }).returning();
  return created;
}

export async function latestApproved(siteId: string): Promise<PolicyVersion | null> {
  const [v] = await db
    .select()
    .from(schema.policyVersions)
    .where(and(eq(schema.policyVersions.siteId, siteId), eq(schema.policyVersions.status, "approved")))
    .orderBy(desc(schema.policyVersions.approvedAt))
    .limit(1);
  return v ?? null;
}

/** Pull { policy_md, terms_md, summary } out of whatever shape an agent or workflow returned. */
export function extractDraft(output: unknown, depth = 0): { policyMd: string; termsMd?: string; summary?: string } | null {
  if (depth > 4 || output == null) return null;
  const parsed = typeof output === "string" ? parseJsonOutput(output) : output;
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.policy_md === "string" && o.policy_md.trim()) {
    return {
      policyMd: o.policy_md,
      termsMd: typeof o.terms_md === "string" ? o.terms_md : undefined,
      summary: typeof o.summary === "string" ? o.summary : undefined,
    };
  }
  for (const v of Object.values(o)) {
    if (v && (typeof v === "object" || typeof v === "string")) {
      const found = extractDraft(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function trimFindings<T extends { snippet?: string }>(list: T[]): T[] {
  return list.slice(0, 200).map((f) => (f.snippet ? { ...f, snippet: f.snippet.slice(0, 200) } : f));
}

/**
 * Build the agent inputs. Findings and metadata only: never tokens, connection strings or row values.
 */
export function buildInputs(scan: Scan, project: Project, versionId: string, draftMd: string, draftTerms: string, existingPolicyMd: string | null) {
  const p = scanParts(scan);
  return {
    scan_id: scan.id,
    policy_version_id: versionId,
    app_name: project.name,
    frameworks: projectFrameworks(project),
    markets: project.markets,
    gaps: p.gaps,
    code_findings: trimFindings(p.codeFindings),
    schema_findings: p.schemaFindings,
    db_findings: p.dbFindings,
    policy_claims: p.claims,
    existing_policy_md: existingPolicyMd,
    baseline_policy_md: draftMd,
    baseline_terms_md: draftTerms,
  };
}

export type ReviewResult = { version: PolicyVersion; mode: AgentMode; reused: boolean; runId: string | null };

/**
 * Create a pending_review policy version for this scan (deterministic draft first), then hand it to AgenticOrg:
 * Path A workflow if AGENTICORG_WORKFLOW_ID is set, else Path B reviewer agent run. If AgenticOrg is unavailable
 * the deterministic draft stays pending_review for an admin to approve at /admin/approvals.
 */
export async function requestReview(opts: {
  scan: Scan;
  project: Project;
  userId: string;
  action: ReviewAction;
  extraInputs?: Record<string, unknown>;
  agentTimeoutMs?: number;
}): Promise<ReviewResult> {
  const { scan, project, userId, action } = opts;
  const site = await ensureSite(project);

  const [pending] = await db
    .select()
    .from(schema.policyVersions)
    .where(and(eq(schema.policyVersions.siteId, site.id), eq(schema.policyVersions.scanId, scan.id), eq(schema.policyVersions.status, "pending_review")))
    .limit(1);
  if (pending) return { version: pending, mode: (pending.agentMode as AgentMode) ?? "manual", reused: true, runId: pending.agentRunId };

  const draft = generateFromScan(scan, project);
  const [version] = await db
    .insert(schema.policyVersions)
    .values({ siteId: site.id, scanId: scan.id, policyMd: draft.policyMd, termsMd: draft.termsMd, summary: draft.summary, status: "pending_review", agentMode: "manual" })
    .returning();

  const previous = await latestApproved(site.id);
  const inputs = { ...buildInputs(scan, project, version.id, draft.policyMd, draft.termsMd, previous?.policyMd ?? null), ...(opts.extraInputs ?? {}) };

  let mode: AgentMode = "manual";
  let runId: string | null = null;
  let error: string | null = null;
  let patch: Partial<typeof schema.policyVersions.$inferInsert> = {};

  const client = agenticorg();
  const workflowId = process.env.AGENTICORG_WORKFLOW_ID;
  const reviewerId = process.env.AGENTICORG_REVIEWER_AGENT_ID;

  // Step 1: the Compliance Reviewer agent drafts (hackathon key: run-only, so we take the draft from the
  // synchronous run; its hitl_triggered status also files an approval item on AgenticOrg).
  if (client && reviewerId) {
    const res = await runAgent(reviewerId, action, inputs, opts.agentTimeoutMs ?? 60_000);
    // Some AgenticOrg agent personas "escalate" instead of drafting (output.status = escalated, no policy_md). Treat as a failed run.
    const escalated = !!res && typeof res.output === "object" && res.output !== null && (res.output as { status?: string }).status === "escalated";
    if (escalated && res) res.error = (res.output as { escalation_reason?: string }).escalation_reason ?? "agent escalated instead of drafting";
    const failed = !res || escalated || /fail|error/i.test(String(res.status ?? "")) || (!!res.error && !res.output);
    if (res && !failed) {
      mode = "agent";
      runId = res.run_id ? String(res.run_id) : null;
      const out = extractDraft(res.output);
      if (out) {
        patch = {
          policyMd: ensureDisclaimer(out.policyMd),
          ...(out.termsMd && out.termsMd.trim().length > 50 ? { termsMd: ensureDisclaimer(out.termsMd) } : {}),
          ...(out.summary ? { summary: out.summary.slice(0, 2000) } : {}),
        };
      }
      await logEvent("agent_action", userId, {
        action, mode, runId, policyVersionId: version.id, scanId: scan.id,
        status: res.status ?? null, hitl: res.hitl_trigger ?? null, draftFromAgent: !!out,
      });
    } else {
      error = (error ? error + "; " : "") + (res ? `agent run ${String(res.status ?? "failed")}: ${String(res.error ?? "").slice(0, 200)}` : "agent run unavailable or timed out");
    }
  }

  // Step 2: the "PolicyDrift review" workflow = reviewer step -> human_in_loop -> finish. Starting it creates the
  // approval item on AgenticOrg. We poll getRun from report polls when the key allows reads; otherwise the draft
  // stays pending_review for /admin/approvals.
  if (client && workflowId) {
    try {
      const res = await withTimeout(client.workflows.run(workflowId, { payload: withInstructions(action, { action, ...inputs }) }), 25_000);
      const id = res ? (res.run_id ?? res.id ?? res.workflow_run_id) : null;
      if (typeof id === "string" || typeof id === "number") {
        mode = "workflow";
        runId = String(id);
      } else error = (error ? error + "; " : "") + (res ? "workflow run returned no run id" : "workflow run timed out");
    } catch (err) {
      error = (error ? error + "; " : "") + (err as Error).message.slice(0, 300);
    }
  }

  const [updated] = await db
    .update(schema.policyVersions)
    .set({ ...patch, agentMode: mode, agentRunId: runId })
    .where(eq(schema.policyVersions.id, version.id))
    .returning();

  if (mode === "workflow") {
    await logEvent("agent_action", userId, { action, mode, runId, policyVersionId: version.id, scanId: scan.id, workflowId });
  } else if (mode === "manual") {
    await logEvent("agent_action", userId, {
      action, mode, policyVersionId: version.id, scanId: scan.id,
      fallback: "deterministic draft pending admin approval", error: error ?? (client ? "no workflow or reviewer agent configured" : "AGENTICORG_API_KEY not set"),
    });
  }

  return { version: updated ?? version, mode, reused: false, runId };
}
