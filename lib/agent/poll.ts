import { and, eq, inArray, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { db, logEvent, schema } from "../db";
import type { Scan, User } from "../db/schema";
import { agenticorg, withTimeout } from "../ai";
import { approveVersion, rejectVersion } from "./approve";
import { extractDraft } from "./review";
import { latestCommitSha, queueRescan, runAfterResponse, runScanAndReview } from "./rescan";

const RUN_POLL_MS = 10_000;
const WATCH_POLL_MS = 60_000;
const GIVE_UP_MS = 30 * 60_000;

type RunVerdict = { state: "pending" | "approved" | "rejected" | "failed"; note: string | null; raw: Record<string, unknown> };

const PENDING = /^(queued|pending|running|in_progress|started|waiting.*|awaiting.*|paused|hitl.*|needs?_approval|pending_approval|blocked)$/;
const DONE = /^(completed?|succeeded|success|successful|approved|done|finished)$/;
const FAILED = /^(failed|failure|error|errored|cancell?ed|timed_out|timeout|aborted)$/;

function findString(o: unknown, keys: string[], depth = 0): string | null {
  if (!o || typeof o !== "object" || depth > 5) return null;
  const rec = o as Record<string, unknown>;
  for (const k of keys) if (typeof rec[k] === "string" && (rec[k] as string).trim()) return rec[k] as string;
  for (const v of Object.values(rec)) {
    const f = findString(v, keys, depth + 1);
    if (f) return f;
  }
  return null;
}

/** AgenticOrg's getRun shape is not documented in the SDK types; read it defensively. */
export function interpretWorkflowRun(raw: Record<string, unknown>): RunVerdict {
  const status = String(raw.status ?? raw.state ?? (raw.run as Record<string, unknown> | undefined)?.status ?? "").toLowerCase();
  const flat = JSON.stringify(raw).toLowerCase();
  const rejected =
    status === "rejected" ||
    /"(decision|approval_status|approval_decision|outcome|verdict)"\s*:\s*"(rejected|reject|denied|declined)"/.test(flat);
  const note = findString(raw, ["reviewer_note", "rejection_reason", "decision_note", "note", "comment", "reason"]);
  if (rejected) return { state: "rejected", note, raw };
  if (DONE.test(status)) return { state: "approved", note, raw };
  if (FAILED.test(status)) return { state: "failed", note: note ?? String(raw.error ?? status), raw };
  if (PENDING.test(status) || !status) return { state: "pending", note: null, raw };
  return { state: "pending", note: null, raw };
}

async function checkPendingRuns(user: User): Promise<void> {
  const client = agenticorg();
  // Claim versions not polled in the last 10s (DB-based throttle: Vercel functions share no memory).
  const cutoff = new Date(Date.now() - RUN_POLL_MS);
  const candidates = await db
    .select({ id: schema.policyVersions.id })
    .from(schema.policyVersions)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.policyVersions.siteId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sites.projectId))
    .where(
      and(
        eq(schema.projects.userId, user.id),
        eq(schema.policyVersions.status, "pending_review"),
        inArray(schema.policyVersions.agentMode, ["workflow", "agent"]),
        or(isNull(schema.policyVersions.lastPolledAt), lt(schema.policyVersions.lastPolledAt, cutoff)),
      ),
    )
    .limit(5);
  if (!candidates.length) return;

  const claimed = await db
    .update(schema.policyVersions)
    .set({ lastPolledAt: new Date() })
    .where(
      and(
        inArray(schema.policyVersions.id, candidates.map((c) => c.id)),
        or(isNull(schema.policyVersions.lastPolledAt), lt(schema.policyVersions.lastPolledAt, cutoff)),
      ),
    )
    .returning();

  for (const v of claimed) {
    const age = Date.now() - v.createdAt.getTime();
    if (age > GIVE_UP_MS) {
      // Stop polling; the draft stays pending_review so an admin can still approve it at /admin/approvals.
      await db.update(schema.policyVersions).set({ agentMode: "manual" }).where(eq(schema.policyVersions.id, v.id));
      await logEvent("agent_action", user.id, { action: "gave_up_waiting", mode: v.agentMode, runId: v.agentRunId, policyVersionId: v.id, minutes: Math.round(age / 60000) });
      continue;
    }
    // Path B has no status endpoint in the SDK: approval arrives via POST /api/agent/publish.
    if (v.agentMode !== "workflow" || !v.agentRunId || !client) continue;

    let raw: Record<string, unknown> | null = null;
    try {
      raw = await withTimeout(client.workflows.getRun(v.agentRunId), 8_000);
    } catch (err) {
      console.error("getRun failed", v.agentRunId, (err as Error).message);
    }
    if (!raw) continue;
    const verdict = interpretWorkflowRun(raw);
    if (verdict.state === "approved") {
      const out = extractDraft(raw.output ?? raw.result ?? raw);
      await approveVersion(v.id, "agenticorg_workflow", verdict.note, out ?? undefined);
    } else if (verdict.state === "rejected") {
      await rejectVersion(v.id, "agenticorg_workflow", verdict.note);
    } else if (verdict.state === "failed") {
      await db.update(schema.policyVersions).set({ agentMode: "manual" }).where(eq(schema.policyVersions.id, v.id));
      await logEvent("agent_action", user.id, { action: "workflow_failed", runId: v.agentRunId, policyVersionId: v.id, error: (verdict.note ?? "").slice(0, 300) });
    }
  }
}

async function checkRepoChange(scan: Scan, user: User): Promise<void> {
  const cutoff = new Date(Date.now() - WATCH_POLL_MS);
  const [project] = await db
    .update(schema.projects)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(schema.projects.id, scan.projectId),
        eq(schema.projects.userId, user.id),
        eq(schema.projects.watch, true),
        eq(schema.projects.source, "github"),
        isNotNull(schema.projects.repoFullName),
        or(isNull(schema.projects.lastCheckedAt), lt(schema.projects.lastCheckedAt, cutoff)),
      ),
    )
    .returning();
  if (!project) return;

  const sha = await latestCommitSha(project, user.githubTokenEnc);
  if (!sha) return;
  const baseline = project.lastScannedSha ?? scan.commitSha;
  if (!baseline) {
    // First check after a scan that didn't record a SHA: adopt it as the baseline, no re-scan.
    await db.update(schema.projects).set({ lastScannedSha: sha }).where(and(eq(schema.projects.id, project.id), sql`${schema.projects.lastScannedSha} is null`));
    return;
  }
  if (baseline === sha) return;
  const scanId = await queueRescan({ ...project, lastScannedSha: baseline }, sha, "poll");
  // Runs after this poll's response is sent, within the calling route's maxDuration.
  if (scanId) runAfterResponse(() => runScanAndReview(scanId));
}

/**
 * Called from the report page's status poll (GET /api/scans/:id). Never throws.
 * - at most every 10s per version: check AgenticOrg workflow runs for this user's pending policy versions
 * - at most every 60s per project: compare the default branch SHA to last_scanned_sha; on change queue a re-scan
 */
export async function onReportPoll(scan: Scan, user: User): Promise<void> {
  await Promise.all([
    checkPendingRuns(user).catch((err) => console.error("checkPendingRuns", (err as Error).message)),
    checkRepoChange(scan, user).catch((err) => console.error("checkRepoChange", (err as Error).message)),
  ]);
}
