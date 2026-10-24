import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, logEvent, schema } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { isMonthly } from "@/lib/entitlements";
import { latestCommitSha, queueRescan, runScanAndReview } from "@/lib/agent/rescan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHECK_EVERY_MS = 4 * 60_000;
const TIME_BUDGET_MS = 240_000;

/**
 * Drift Watch agent. Called every 5 minutes by .github/workflows/drift-watch.yml (GitHub Actions cron)
 * with Authorization: Bearer CRON_SECRET. For every watched GitHub project whose owner is on Pro monthly:
 * compare the default branch SHA with the last scanned one; on change queue a re-scan, run it, diff the
 * gaps, notify the owner (dashboard + email when configured) and hand new gaps to the reviewer agent.
 * Also drains scans left queued by an earlier run. Idempotent: the SHA claim in queueRescan prevents duplicates.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() || new URL(req.url).searchParams.get("key") || "";
  if (!secret || !got || !safeEqual(got, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const cutoff = new Date(started - CHECK_EVERY_MS);
  const projects = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.watch, true), eq(schema.projects.source, "github"), isNotNull(schema.projects.repoFullName),
      or(isNull(schema.projects.lastCheckedAt), lt(schema.projects.lastCheckedAt, cutoff))))
    .orderBy(asc(schema.projects.lastCheckedAt)).limit(25);

  let checked = 0, changed = 0, skipped = 0;
  const queued: string[] = [];
  for (const project of projects) {
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, project.userId)).limit(1);
    await db.update(schema.projects).set({ lastCheckedAt: new Date() }).where(eq(schema.projects.id, project.id));
    if (!owner || !isMonthly(owner)) { skipped++; continue; }
    checked++;
    const sha = await latestCommitSha(project, owner.githubTokenEnc);
    if (!sha) continue;
    if (!project.lastScannedSha) {
      await db.update(schema.projects).set({ lastScannedSha: sha }).where(and(eq(schema.projects.id, project.id), sql`${schema.projects.lastScannedSha} is null`));
      continue;
    }
    if (project.lastScannedSha === sha) continue;
    changed++;
    const id = await queueRescan(project, sha, "poll");
    if (id) queued.push(id);
  }

  // Drain: this run's scans plus anything still queued from before.
  const pending = await db.select({ id: schema.scans.id }).from(schema.scans)
    .where(inArray(schema.scans.status, ["queued"])).orderBy(asc(schema.scans.createdAt)).limit(10);
  const toRun = [...new Set([...queued, ...pending.map((p) => p.id)])];
  const ran: string[] = [];
  for (const id of toRun) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    await runScanAndReview(id);
    ran.push(id);
  }

  const summary = { checked, skipped, changed, queued: queued.length, scanned: ran.length, ms: Date.now() - started };
  await logEvent("watch_run", null, summary);
  return NextResponse.json({ ok: true, ...summary });
}
