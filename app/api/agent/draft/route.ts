import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, logEvent, schema } from "@/lib/db";
import { bearerOk, UUID_RE } from "@/lib/agent/access";
import { ensureSite } from "@/lib/agent/review";
import { ensureDisclaimer, generateFromScan } from "@/lib/policy/generate";

export const dynamic = "force-dynamic";

// POST /api/agent/draft  (Path B connector tool `save_policy_draft`, bearer MCP_TOKEN)
// Body: { scan_id, policy_md, terms_md?, summary?, policy_version_id? }
// Updates the pending version named by policy_version_id, or creates a new pending_review version for the scan.
export async function POST(req: Request) {
  if (!bearerOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : "");
  const scanId = str("scan_id");
  const policyMd = str("policy_md");
  if (!UUID_RE.test(scanId) || policyMd.trim().length < 50) {
    return NextResponse.json({ error: "scan_id and policy_md required" }, { status: 400 });
  }

  const [row] = await db
    .select({ scan: schema.scans, project: schema.projects })
    .from(schema.scans)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.scans.projectId))
    .where(eq(schema.scans.id, scanId))
    .limit(1);
  if (!row) return NextResponse.json({ error: "scan not found" }, { status: 404 });

  const site = await ensureSite(row.project);
  const values = {
    policyMd: ensureDisclaimer(policyMd),
    ...(str("terms_md").trim().length > 50 ? { termsMd: ensureDisclaimer(str("terms_md")) } : {}),
    ...(str("summary") ? { summary: str("summary").slice(0, 2000) } : {}),
  };

  let versionId: string | null = null;
  const vid = str("policy_version_id");
  if (UUID_RE.test(vid)) {
    const [u] = await db
      .update(schema.policyVersions)
      .set(values)
      .where(and(eq(schema.policyVersions.id, vid), eq(schema.policyVersions.siteId, site.id), eq(schema.policyVersions.status, "pending_review")))
      .returning({ id: schema.policyVersions.id });
    versionId = u?.id ?? null;
  }
  if (!versionId) {
    const [c] = await db
      .insert(schema.policyVersions)
      .values({ siteId: site.id, scanId, termsMd: generateFromScan(row.scan, row.project).termsMd, ...values, status: "pending_review", agentMode: "agent" })
      .returning({ id: schema.policyVersions.id });
    versionId = c.id;
  }

  await logEvent("agent_action", row.project.userId, { action: "save_policy_draft", via: "agenticorg_connector", policyVersionId: versionId, scanId });
  return NextResponse.json({ ok: true, policy_version_id: versionId, status: "pending_review" });
}
