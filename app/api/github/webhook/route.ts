import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hmacHex, safeEqual } from "@/lib/crypto";
import { queueRescan, runAfterResponse, runScanAndReview } from "@/lib/agent/rescan";
import { isMonthly } from "@/lib/entitlements";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/github/webhook — push on a watched project's repo -> re-scan + re-review (T10).
// Added by hand on the demo repo: content type application/json, secret GITHUB_WEBHOOK_SECRET, "Just the push event".
export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!sig.startsWith("sha256=") || !safeEqual(sig, `sha256=${hmacHex(secret, raw)}`)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  let payload: { ref?: string; after?: string; deleted?: boolean; repository?: { full_name?: string; default_branch?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const repo = payload.repository?.full_name;
  const sha = payload.after;
  if (!repo || !sha || payload.deleted || /^0+$/.test(sha)) return NextResponse.json({ ok: true, ignored: "no commit" });

  const projects = await db
    .select()
    .from(schema.projects)
    .where(and(sql`lower(${schema.projects.repoFullName}) = ${repo.toLowerCase()}`, eq(schema.projects.watch, true)));

  const queued: string[] = [];
  for (const project of projects) {
    const branch = project.defaultBranch || payload.repository?.default_branch || "main";
    if (payload.ref !== `refs/heads/${branch}`) continue;
    // Re-check on every push is a Pro monthly feature.
    const [owner] = await db.select({ isPro: schema.users.isPro, proUntil: schema.users.proUntil }).from(schema.users).where(eq(schema.users.id, project.userId)).limit(1);
    if (!owner || !isMonthly(owner)) continue;
    const scanId = await queueRescan(project, sha, "webhook");
    if (scanId) queued.push(scanId);
  }

  // Respond to GitHub fast (10s timeout); the scans run after the response within maxDuration.
  if (queued.length) {
    runAfterResponse(async () => {
      for (const id of queued) await runScanAndReview(id);
    });
  }
  return NextResponse.json({ ok: true, queued }, { status: 202 });
}
