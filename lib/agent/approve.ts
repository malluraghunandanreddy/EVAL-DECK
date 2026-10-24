import { and, eq } from "drizzle-orm";
import { db, logEvent, schema } from "../db";
import { ensureDisclaimer } from "../policy/generate";

export type ApprovalVia = "agenticorg_workflow" | "agenticorg_connector" | "admin";

async function ownerOf(siteId: string): Promise<{ userId: string | null; projectId: string | null }> {
  const [row] = await db
    .select({ userId: schema.projects.userId, projectId: schema.projects.id })
    .from(schema.sites)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sites.projectId))
    .where(eq(schema.sites.id, siteId))
    .limit(1);
  return row ?? { userId: null, projectId: null };
}

export type FinalContent = { policyMd?: string; termsMd?: string; summary?: string };

function contentPatch(c?: FinalContent) {
  const patch: Partial<typeof schema.policyVersions.$inferInsert> = {};
  if (c?.policyMd && c.policyMd.trim().length > 50) patch.policyMd = ensureDisclaimer(c.policyMd);
  if (c?.termsMd && c.termsMd.trim().length > 50) patch.termsMd = ensureDisclaimer(c.termsMd);
  if (c?.summary && c.summary.trim()) patch.summary = c.summary.trim().slice(0, 2000);
  return patch;
}

/** Approve a pending version: widget and hosted pages serve it from now on. Idempotent. */
export async function approveVersion(versionId: string, via: ApprovalVia, note?: string | null, content?: FinalContent) {
  const [v] = await db
    .update(schema.policyVersions)
    .set({ ...contentPatch(content), status: "approved", approvedAt: new Date(), reviewerNote: note ?? null })
    .where(and(eq(schema.policyVersions.id, versionId), eq(schema.policyVersions.status, "pending_review")))
    .returning();
  if (!v) return null;
  await db.update(schema.sites).set({ outOfDate: false }).where(eq(schema.sites.id, v.siteId));
  const { userId, projectId } = await ownerOf(v.siteId);
  await logEvent("approval", userId, { via, policyVersionId: v.id, siteId: v.siteId, scanId: v.scanId, projectId, runId: v.agentRunId, note: note ?? null });
  return v;
}

export async function rejectVersion(versionId: string, via: ApprovalVia, note?: string | null) {
  const [v] = await db
    .update(schema.policyVersions)
    .set({ status: "rejected", reviewerNote: note ?? "Rejected by reviewer" })
    .where(and(eq(schema.policyVersions.id, versionId), eq(schema.policyVersions.status, "pending_review")))
    .returning();
  if (!v) return null;
  const { userId, projectId } = await ownerOf(v.siteId);
  await logEvent("rejection", userId, { via, policyVersionId: v.id, siteId: v.siteId, scanId: v.scanId, projectId, runId: v.agentRunId, note: v.reviewerNote });
  return v;
}

export { ownerOf };
