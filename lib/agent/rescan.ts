import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, logEvent, schema } from "../db";
import type { Project, Scan } from "../db/schema";
import type { Gap } from "../types";
import { decrypt } from "../crypto";
import { runScan } from "@/lib/scan/run";
import { latestApproved, requestReview } from "./review";
import { notify } from "../notify";

const GH = "https://api.github.com";

/** Latest commit SHA of the project's default branch, using the owner's decrypted token. Null on any failure. */
export async function latestCommitSha(project: Pick<Project, "repoFullName" | "defaultBranch">, tokenEnc: string | null): Promise<string | null> {
  if (!project.repoFullName) return null;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "PolicyDrift", "X-GitHub-Api-Version": "2022-11-28" };
  if (tokenEnc) {
    try {
      headers.Authorization = `Bearer ${decrypt(tokenEnc)}`;
    } catch {
      // bad key/ciphertext: try unauthenticated (works for public repos)
    }
  }
  const ref = encodeURIComponent(project.defaultBranch || "HEAD");
  try {
    const res = await fetch(`${GH}/repos/${project.repoFullName}/commits/${ref}`, { headers, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { sha?: string };
    return typeof body.sha === "string" ? body.sha : null;
  } catch {
    return null;
  }
}

/**
 * Record a repo change and create a queued scan for it. Returns the scan id, or null when a scan
 * is already queued/running for the project or the SHA was already seen.
 */
export async function queueRescan(project: Project, sha: string, via: "poll" | "webhook" | "check"): Promise<string | null> {
  const [active] = await db
    .select({ id: schema.scans.id })
    .from(schema.scans)
    .where(and(eq(schema.scans.projectId, project.id), inArray(schema.scans.status, ["queued", "running"])))
    .limit(1);
  if (active) return null; // try again on a later poll once it finishes

  // Claim the SHA atomically so concurrent polls/webhooks don't double-queue.
  const claimed = await db
    .update(schema.projects)
    .set({ lastScannedSha: sha })
    .where(and(eq(schema.projects.id, project.id), sql`${schema.projects.lastScannedSha} is distinct from ${sha}`))
    .returning({ id: schema.projects.id });
  if (!claimed.length) return null;

  const [scan] = await db.insert(schema.scans).values({ projectId: project.id, status: "queued", commitSha: sha }).returning({ id: schema.scans.id });
  await logEvent("repo_changed", project.userId, { projectId: project.id, repo: project.repoFullName, from: project.lastScannedSha, to: sha, scanId: scan.id, via });
  return scan.id;
}

/** Run a scan and then the re-review diff. Awaitable (webhook) or scheduled after the response (poll). */
export async function runScanAndReview(scanId: string): Promise<void> {
  try {
    await runScan(scanId);
  } catch (err) {
    console.error("rescan failed", scanId, (err as Error).message);
    return;
  }
  try {
    await notifyChange(scanId);
  } catch (err) {
    console.error("notifyChange failed", scanId, (err as Error).message);
  }
  try {
    await afterScan(scanId);
  } catch (err) {
    console.error("afterScan failed", scanId, (err as Error).message);
  }
}

/**
 * Drift Watch notification: after a re-scan triggered by a repo change, compare with the previous finished
 * scan of the same project and tell the owner what moved (dashboard, plus email when configured).
 * Only for scans that came from a change (repo_changed event); the first scan of a project is not a change.
 */
export async function notifyChange(scanId: string): Promise<void> {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId)).limit(1);
  if (!scan) return;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scan.projectId)).limit(1);
  if (!project) return;
  const [change] = await db.select({ id: schema.events.id, payload: schema.events.payload }).from(schema.events)
    .where(and(eq(schema.events.type, "repo_changed"), sql`${schema.events.payload}->>'scanId' = ${scan.id}`)).limit(1);
  if (!change) return;
  const [already] = await db.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.scanId, scan.id)).limit(1);
  if (already) return;

  const repo = project.repoFullName ?? project.name;
  const sha = (scan.commitSha ?? (change.payload as { to?: string }).to ?? "").slice(0, 7);
  if (scan.status !== "done") {
    await notify(project.userId, { type: "rescan_failed", title: `New commit on ${repo}, but the re-scan failed`, body: scan.error ?? "We will try again on the next check.", href: `/scan/${scan.id}`, projectId: project.id, scanId: scan.id });
    return;
  }
  const [prev] = await db.select().from(schema.scans)
    .where(and(eq(schema.scans.projectId, project.id), eq(schema.scans.status, "done"), sql`${schema.scans.id} <> ${scan.id}`, sql`${schema.scans.createdAt} < ${scan.createdAt}`))
    .orderBy(desc(schema.scans.createdAt)).limit(1);
  const oldIds = prev ? gapIds(prev) : new Set<string>();
  const gaps = Array.isArray(scan.gaps) ? (scan.gaps as Gap[]) : [];
  const added = gaps.filter((g) => !oldIds.has(g.id));
  const newIds = new Set(gaps.map((g) => g.id));
  const removed = [...oldIds].filter((id) => !newIds.has(id)).length;
  const title = added.length
    ? `New commit ${sha} on ${repo}: ${added.length} new gap${added.length === 1 ? "" : "s"}${removed ? `, ${removed} fixed` : ""}`
    : removed
      ? `New commit ${sha} on ${repo}: ${removed} gap${removed === 1 ? "" : "s"} fixed, nothing new`
      : `New commit ${sha} on ${repo}: no change to your privacy gaps`;
  const body = added.length
    ? added.slice(0, 3).map((g) => `${g.severity.toUpperCase()}: ${g.title}`).join("\n") + (added.length > 3 ? `\n+${added.length - 3} more` : "")
    : `${gaps.length} gap${gaps.length === 1 ? "" : "s"} in total. Your published policy, if any, still matches.`;
  await notify(project.userId, { type: added.length ? "new_gaps" : "rescan_clean", title, body, href: `/scan/${scan.id}`, projectId: project.id, scanId: scan.id });
}

/** Schedule work after the response is sent (Vercel waitUntil via next/server `after`); falls back to fire-and-forget. */
export function runAfterResponse(fn: () => Promise<void>) {
  try {
    after(fn);
  } catch {
    void fn().catch((err) => console.error("background task failed", (err as Error).message));
  }
}

function gapIds(scan: Pick<Scan, "gaps">): Set<string> {
  return new Set((Array.isArray(scan.gaps) ? (scan.gaps as Gap[]) : []).map((g) => g.id));
}

/**
 * T10 diff: compare the finished scan's gap ids to the scan behind the last approved policy version.
 * No new gaps -> rescan_clean. New gaps -> widget out_of_date=true, and for Pro users a reviewer run
 * with action update_policy { previous_policy_md, new_gaps, removed_gaps }. Safe to call more than once.
 */
export async function afterScan(scanId: string): Promise<void> {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId)).limit(1);
  if (!scan || scan.status !== "done") return;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scan.projectId)).limit(1);
  if (!project) return;
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.projectId, project.id)).limit(1);
  if (!site) return; // nothing published yet, nothing to compare against
  const approved = await latestApproved(site.id);
  if (!approved || approved.scanId === scan.id) return;

  // idempotency: already handled this scan?
  const [seen] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(inArray(schema.events.type, ["rescan_clean", "agent_action"]), sql`${schema.events.payload}->>'rescanOf' = ${scan.id}`))
    .limit(1);
  if (seen) return;

  const [baseline] = await db.select().from(schema.scans).where(eq(schema.scans.id, approved.scanId)).limit(1);
  const oldIds = baseline ? gapIds(baseline) : new Set<string>();
  const gaps = Array.isArray(scan.gaps) ? (scan.gaps as Gap[]) : [];
  const newGaps = gaps.filter((g) => !oldIds.has(g.id));
  const newIds = new Set(gaps.map((g) => g.id));
  const removedIds = [...oldIds].filter((id) => !newIds.has(id));
  const removedGaps = baseline ? (baseline.gaps as Gap[]).filter((g) => removedIds.includes(g.id)).map(({ id, title, severity }) => ({ id, title, severity })) : [];

  if (newGaps.length === 0) {
    await logEvent("rescan_clean", project.userId, { rescanOf: scan.id, baselineScanId: approved.scanId, policyVersionId: approved.id, removedGapIds: removedIds });
    return;
  }

  await db.update(schema.sites).set({ outOfDate: true }).where(eq(schema.sites.id, site.id));
  await logEvent("agent_action", project.userId, {
    action: "mark_out_of_date", rescanOf: scan.id, siteId: site.id, baselineScanId: approved.scanId,
    newGapIds: newGaps.map((g) => g.id), removedGapIds: removedIds,
  });

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, project.userId)).limit(1);
  if (!user?.isPro) return;

  const result = await requestReview({
    scan,
    project,
    userId: user.id,
    action: "update_policy",
    extraInputs: { previous_policy_md: approved.policyMd, new_gaps: newGaps, removed_gaps: removedGaps },
  });
  await notify(user.id, {
    type: "policy_update_pending",
    title: `Policy update drafted for ${project.repoFullName ?? project.name}`,
    body: `${newGaps.length} new gap${newGaps.length === 1 ? "" : "s"} changed what your policy must say. The reviewer agent drafted the update; it goes live after human approval. Your widget shows "review pending" until then.`,
    href: `/scan/${scan.id}`, projectId: project.id, scanId: scan.id,
  });
  void result;
}

export async function lastScanFor(projectId: string): Promise<Scan | null> {
  const [s] = await db.select().from(schema.scans).where(eq(schema.scans.projectId, projectId)).orderBy(desc(schema.scans.createdAt)).limit(1);
  return s ?? null;
}
