import { eq } from "drizzle-orm";
import { decrypt } from "../crypto";
import { db, logEvent, schema } from "../db";
import type { Framework } from "../types";
import { analyzeDirectory } from "./analyze";
import { ingestGithub, ingestZip, type Ingested } from "./ingest";
import { extractClaims, fetchPolicyText, findPolicyInRepo } from "./policy";
import { readRepo } from "./files";

export { analyzeDirectory } from "./analyze";
export type { AnalyzeOptions, AnalyzeResult } from "./analyze";
export { engineFromFindings } from "./evaluate";

const SAFE_ERRORS = /larger than 20 MB|not found or not accessible|Invalid repository|Zip uploads|tarball download failed|No repository/;

/**
 * Run a queued scan end to end inside the current request: ingest -> detect -> policy -> engine -> checklist -> store.
 * Never throws; failures set scans.status = "failed" with a user-safe message.
 */
export async function runScan(scanId: string): Promise<void> {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId)).limit(1);
  if (!scan) return;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scan.projectId)).limit(1);
  if (!project) {
    await db.update(schema.scans).set({ status: "failed", error: "Project not found", finishedAt: new Date() }).where(eq(schema.scans.id, scanId));
    return;
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, project.userId)).limit(1);
  const started = Date.now();
  await db.update(schema.scans).set({ status: "running", error: null }).where(eq(schema.scans.id, scanId));
  await logEvent("scan_started", project.userId, { scanId, projectId: project.id, repo: project.repoFullName, source: project.source });

  let ingested: Ingested | null = null;
  try {
    if (project.source === "zip") {
      if (!project.zipPath) throw new Error("No repository or zip attached to this project");
      ingested = await ingestZip(project.zipPath);
    } else {
      if (!project.repoFullName) throw new Error("No repository attached to this project");
      const token = user?.githubTokenEnc ? decrypt(user.githubTokenEnc) : null;
      ingested = await ingestGithub(project.repoFullName, token, project.defaultBranch);
    }

    const frameworks = (project.frameworks as Framework[]).length ? (project.frameworks as Framework[]) : (["GDPR"] as Framework[]);

    // Policy: project URL first, else a PRIVACY.* file in the repo; Policy Reader agent with keyword fallback.
    let policyText = project.policyUrl ? await fetchPolicyText(project.policyUrl) : null;
    if (!policyText) policyText = findPolicyInRepo(readRepo(ingested.dir));
    const { claims, source: claimsSource } = await extractClaims(policyText);

    // Live DB findings are added later by the Pro DB check (T9), which re-runs engineFromFindings.
    const r = await analyzeDirectory(ingested.dir, { frameworks, policyText, claims });

    await db.update(schema.scans).set({
      status: "done",
      commitSha: ingested.sha,
      policyClaims: r.policyClaims,
      codeFindings: r.codeFindings,
      schemaFindings: r.schemaFindings,
      dbFindings: null,
      gaps: r.gaps,
      checklist: r.checklist,
      // signals kept alongside coverage so T9 can re-run the engine without the repo
      coverage: { ...r.coverage, signals: r.signals },
      finishedAt: new Date(),
    }).where(eq(schema.scans.id, scanId));

    await db.update(schema.projects).set({
      lastScannedSha: ingested.sha ?? project.lastScannedSha,
      dbEnvHints: r.dbEnvHints,
    }).where(eq(schema.projects.id, project.id));

    const todo = r.checklist.filter((i) => i.status === "todo").length;
    await logEvent("scan_done", project.userId, {
      scanId, projectId: project.id, sha: ingested.sha, ms: Date.now() - started, gaps: r.gaps.length, todo,
      codeFindings: r.codeFindings.length, schemaFindings: r.schemaFindings.length, claimsSource, frameworks,
    });
  } catch (err) {
    const raw = (err as Error).message ?? "Scan failed";
    const message = SAFE_ERRORS.test(raw) ? raw : "Scan failed while reading the repository";
    console.error("scan failed", scanId, raw.replace(/gh[pousr]_[A-Za-z0-9]+/g, "[token]"));
    await db.update(schema.scans).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(schema.scans.id, scanId));
    await logEvent("scan_done", project.userId, { scanId, projectId: project.id, status: "failed", error: message });
  } finally {
    if (ingested) await ingested.cleanup().catch(() => {});
  }
}
