import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, logEvent, schema } from "@/lib/db";
import { bearerOk, UUID_RE } from "@/lib/agent/access";
import { approveVersion, ownerOf } from "@/lib/agent/approve";

export const dynamic = "force-dynamic";

// POST /api/agent/publish  (Path B connector tool `publish_policy`, bearer MCP_TOKEN)
// Body: { policy_version_id, policy_md?, terms_md?, summary?, note? }
// AgenticOrg calls this only after a human approved the reviewer's HITL gate.
export async function POST(req: Request) {
  if (!bearerOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.policy_version_id === "string" ? body.policy_version_id : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "policy_version_id required" }, { status: 400 });

  const [v] = await db.select().from(schema.policyVersions).where(eq(schema.policyVersions.id, id)).limit(1);
  if (!v) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (v.status !== "pending_review") return NextResponse.json({ ok: true, policy_version_id: v.id, status: v.status, already: true });

  const str = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : undefined);
  const approved = await approveVersion(v.id, "agenticorg_connector", str("note") ?? null, {
    policyMd: str("policy_md"),
    termsMd: str("terms_md"),
    summary: str("summary"),
  });
  const { userId } = await ownerOf(v.siteId);
  await logEvent("agent_action", userId, { action: "publish_policy", via: "agenticorg_connector", policyVersionId: v.id, ok: !!approved });
  return NextResponse.json({ ok: !!approved, policy_version_id: v.id, status: approved?.status ?? v.status, site_id: v.siteId });
}
