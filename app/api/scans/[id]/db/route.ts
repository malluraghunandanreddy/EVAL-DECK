import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, logEvent, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { ownedScan } from "@/lib/agent/access";
import { scanUnlocked } from "@/lib/entitlements";
import { checkLiveDb, LiveDbError } from "@/lib/scan/livedb";
import { parseSqliteReport, SqliteReportError } from "@/lib/scan/sqlitereport";
import { engineFromFindings } from "@/lib/scan/evaluate";
import type { CodeFinding, Coverage, Framework, PolicyClaims, SchemaFinding } from "@/lib/types";
import type { EngineSignals, DocConflict, DocPromise } from "@/lib/scan/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.union([
  z.object({ url: z.string().min(12).max(2000) }),
  // SQLite on a server: the structure report printed by SQLITE_REPORT_COMMAND (no row values).
  z.object({ sqliteReport: z.string().min(20).max(400_000) }),
]);

// POST /api/scans/:id/db { url }  (unlocked report or Pro monthly)
// Runs the read-only live database check and re-evaluates the report with the new findings.
// The connection string is used for this one request and never stored or logged.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const owned = await ownedScan(id, user);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { scan, project } = owned;
  if (!scanUnlocked(user, scan)) return NextResponse.json({ error: "pro_required" }, { status: 402 });
  if (scan.status !== "done") return NextResponse.json({ error: "Run the scan first" }, { status: 409 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Paste a connection string or the SQLite report" }, { status: 400 });
  }

  let summary;
  const kind = "url" in body ? "postgres" : "sqlite";
  try {
    summary = "url" in body ? await checkLiveDb(body.url) : parseSqliteReport(body.sqliteReport);
  } catch (err) {
    const msg = err instanceof LiveDbError || err instanceof SqliteReportError ? err.message : "Database check failed";
    await logEvent("db_check", user.id, { scanId: scan.id, projectId: project.id, kind, ok: false, error: msg.slice(0, 200) });
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const cov = (scan.coverage ?? {}) as Partial<Coverage> & { signals?: Partial<EngineSignals> };
  const { gaps, checklist } = engineFromFindings({
    frameworks: project.frameworks as Framework[],
    codeFindings: (scan.codeFindings ?? []) as CodeFinding[],
    schemaFindings: (scan.schemaFindings ?? []) as SchemaFinding[],
    dbFindings: summary.findings,
    claims: (scan.policyClaims ?? { collected: [], purposes: [], thirdParties: [], retention: null, crossBorder: null, noPolicy: true }) as PolicyClaims,
    signals: cov.signals,
    coverage: { code: !!cov.code, schemaFiles: !!cov.schemaFiles, liveDb: true },
    // keep the legal-document checks from the original scan
    docPromises: (scan.documents as { promises?: DocPromise[] } | null)?.promises,
    docConflicts: (scan.documents as { conflicts?: DocConflict[] } | null)?.conflicts,
  });
  await db.update(schema.scans)
    .set({ dbFindings: summary.findings, gaps, checklist, coverage: { ...cov, liveDb: true } })
    .where(eq(schema.scans.id, scan.id));
  await logEvent("db_check", user.id, {
    scanId: scan.id, projectId: project.id, kind, ok: true, tables: summary.tables, columns: summary.columns,
    piiColumns: summary.piiColumns, rlsOff: summary.rlsOff.length, broadRead: summary.broadRead.length, sampledRows: summary.sampledRows,
  });
  const { findings: _omit, ...rest } = summary;
  return NextResponse.json({ ok: true, ...rest, findings: summary.findings.length, gaps: gaps.length });
}
