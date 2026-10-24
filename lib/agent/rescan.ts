import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, logEvent, schema } from "../db";
import type { Project, Scan } from "../db/schema";
import type { Gap } from "../types";
import { decrypt } from "../crypto";
import { runScan } from "@/lib/scan/run";
import { latestApproved, requestReview } from "./review";

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
    await afterScan(scanId);
  } catch (err) {
    console.error("afterScan failed", scanId, (err as Error).message);
  }
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

  await requestReview({
    scan,
    project,
    userId: user.id,
    action: "update_policy",
    extraInputs: { previous_policy_md: approved.policyMd, new_gaps: newGaps, removed_gaps: removedGaps },
  });
}

export async function lastScanFor(projectId: string): Promise<Scan | null> {
  const [s] = await db.select().from(schema.scans).where(eq(schema.scans.projectId, projectId)).orderBy(desc(schema.scans.createdAt)).limit(1);
  return s ?? null;
}
