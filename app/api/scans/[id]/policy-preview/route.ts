import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { ownedScan } from "@/lib/agent/access";
import { scanUnlocked } from "@/lib/entitlements";
import { FREE_SECTIONS, generateFromScan, previewSections } from "@/lib/policy/generate";

export const dynamic = "force-dynamic";

// GET /api/scans/:id/policy-preview
// -> { sections, locked, totalSections, terms: { sections, totalSections }, summary, version }
// Free users get only the first 2 sections of each document, enforced here on the server.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owned = await ownedScan(id, user);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { scan, project } = owned;
  if (scan.status !== "done") return NextResponse.json({ error: "scan_not_done", status: scan.status }, { status: 409 });

  // Prefer the policy version made from this scan (agent draft or approved); else the deterministic draft.
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.projectId, project.id)).limit(1);
  let version: typeof schema.policyVersions.$inferSelect | undefined;
  if (site) {
    [version] = await db
      .select()
      .from(schema.policyVersions)
      .where(and(eq(schema.policyVersions.siteId, site.id), eq(schema.policyVersions.scanId, scan.id)))
      .orderBy(desc(schema.policyVersions.createdAt))
      .limit(1);
  }
  const draft = version && version.status !== "rejected"
    ? { policyMd: version.policyMd, termsMd: version.termsMd, summary: version.summary ?? "" }
    : generateFromScan(scan, project);

  const policy = previewSections(draft.policyMd);
  const terms = previewSections(draft.termsMd);
  const pro = scanUnlocked(user, scan);

  return NextResponse.json({
    sections: pro ? policy : policy.slice(0, FREE_SECTIONS),
    locked: !pro && policy.length > FREE_SECTIONS,
    totalSections: policy.length,
    terms: { sections: pro ? terms : terms.slice(0, FREE_SECTIONS), totalSections: terms.length },
    summary: draft.summary,
    version: version
      ? {
          id: version.id,
          status: version.status,
          reviewerNote: version.reviewerNote,
          agentMode: version.agentMode,
          createdAt: version.createdAt,
          approvedAt: version.approvedAt,
          siteId: version.siteId,
        }
      : null,
    siteId: site?.id ?? null,
    outOfDate: site?.outOfDate ?? false,
    notLegalAdvice: true,
  });
}
