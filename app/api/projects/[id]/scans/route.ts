import { NextResponse, after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { runScanAndReview } from "@/lib/agent/rescan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Start a scan. Inserts the scans row (queued) and returns { scanId } immediately; the scan itself runs
 * inside this same function invocation after the response (next/server `after`, up to maxDuration).
 * The client polls GET /api/scans/:id. `?wait=1` runs it before responding (scripts / tests).
 * runScan writes scan_started / scan_done events and moves status queued -> running -> done | failed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [project] = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id))).limit(1);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // One active scan per project: return the running one instead of starting another.
  const [active] = await db.select({ id: schema.scans.id, status: schema.scans.status }).from(schema.scans)
    .where(and(eq(schema.scans.projectId, project.id), inArray(schema.scans.status, ["queued", "running"]))).limit(1);
  if (active) return NextResponse.json({ scanId: active.id, status: active.status });

  const [scan] = await db.insert(schema.scans).values({ projectId: project.id, status: "queued" })
    .returning({ id: schema.scans.id });

  if (new URL(req.url).searchParams.get("wait") === "1") {
    await runScanAndReview(scan.id);
    const [done] = await db.select({ status: schema.scans.status }).from(schema.scans).where(eq(schema.scans.id, scan.id)).limit(1);
    return NextResponse.json({ scanId: scan.id, status: done?.status ?? "failed" });
  }

  after(() => runScanAndReview(scan.id));
  return NextResponse.json({ scanId: scan.id, status: "queued" }, { status: 202 });
}
