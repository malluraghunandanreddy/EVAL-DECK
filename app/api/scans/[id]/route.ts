import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { headline, stripFixes } from "@/lib/checklist";
import { onReportPoll } from "@/lib/agent/poll";
import { planFor, scanUnlocked } from "@/lib/entitlements";
import type { ChecklistItem, Framework, Gap } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a re-scan triggered by the change watch runs after the response inside this invocation
export const maxDuration = 300;

/** Scan report for its owner. Free users never receive `fix` fields (gaps and checklist). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id)).limit(1);
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, scan.projectId)).limit(1);
  if (!project || project.userId !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // HOOK: agent approval polling + change watch (T6/T10)
  try {
    await onReportPoll(scan, user);
    [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id)).limit(1);
  } catch (err) {
    console.error("report poll hook failed", (err as Error).message);
  }

  const frameworks = project.frameworks as Framework[];
  const gaps = (Array.isArray(scan.gaps) ? scan.gaps : []) as Gap[];
  const checklist = (Array.isArray(scan.checklist) ? scan.checklist : []) as ChecklistItem[];
  const cov = (scan.coverage ?? null) as { code?: boolean; schemaFiles?: boolean; liveDb?: boolean } | null;
  const isPro = scanUnlocked(user, scan);
  const plan = planFor(user, scan);

  // Latest policy draft for this project, so the report shows review status while it polls
  const [pv] = await db
    .select({ status: schema.policyVersions.status, reviewerNote: schema.policyVersions.reviewerNote, siteId: schema.policyVersions.siteId })
    .from(schema.policyVersions)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.policyVersions.siteId))
    .where(eq(schema.sites.projectId, project.id))
    .orderBy(desc(schema.policyVersions.createdAt))
    .limit(1);

  return NextResponse.json({
    id: scan.id,
    status: scan.status,
    error: scan.error,
    commitSha: scan.commitSha,
    createdAt: scan.createdAt,
    finishedAt: scan.finishedAt,
    isPro,
    plan,
    project: {
      id: project.id,
      name: project.name,
      markets: project.markets,
      frameworks,
      repoFullName: project.repoFullName,
      source: project.source,
      policyUrl: project.policyUrl,
      dbEnvHints: project.dbEnvHints ?? [],
    },
    frameworks,
    dbEnvHints: project.dbEnvHints ?? [],
    policyVersion: pv ?? null,
    coverage: cov ? { code: !!cov.code, schemaFiles: !!cov.schemaFiles, liveDb: !!cov.liveDb } : null,
    headlines: Object.fromEntries(frameworks.map((f) => [f, headline(checklist, f)])),
    policyClaims: scan.policyClaims,
    codeFindings: scan.codeFindings ?? [],
    schemaFindings: scan.schemaFindings ?? [],
    dbFindings: scan.dbFindings,
    gaps: isPro ? gaps : stripFixes(gaps),
    checklist: isPro ? checklist : stripFixes(checklist),
    disclaimer: "Not legal advice.",
  }, { headers: { "Cache-Control": "no-store" } });
}
