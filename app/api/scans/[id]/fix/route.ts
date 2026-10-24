import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { logEvent } from "@/lib/db";
import { ownedScan } from "@/lib/agent/access";
import { requestReview } from "@/lib/agent/review";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/scans/:id/fix  (Pro only) — "Publish my policy"
// Creates a pending_review policy version and hands it to AgenticOrg for drafting + human approval.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isPro) return NextResponse.json({ error: "pro_required" }, { status: 402 });
  const owned = await ownedScan(id, user);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { scan, project } = owned;
  if (scan.status !== "done") return NextResponse.json({ error: "scan_not_done", status: scan.status }, { status: 409 });

  await logEvent("fix_requested", user.id, { scanId: scan.id, projectId: project.id });
  const result = await requestReview({ scan, project, userId: user.id, action: "draft_policy" });

  return NextResponse.json({
    policyVersionId: result.version.id,
    siteId: result.version.siteId,
    status: result.version.status, // pending_review -> "Awaiting human review"
    mode: result.mode,             // workflow | agent | manual (admin approves at /admin/approvals)
    runId: result.runId,
    reused: result.reused,
    summary: result.version.summary,
  });
}
