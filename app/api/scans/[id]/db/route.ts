import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, logEvent, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { ownedScan } from "@/lib/agent/access";
import { scanUnlocked } from "@/lib/entitlements";
import { checkLiveDb, LiveDbError } from "@/lib/scan/livedb";
import { parseSqliteReport, SqliteReportError } from "@/lib/scan/sqlitereport";
import { sshSqlite, SshCheckError } from "@/lib/scan/sshsqlite";
import { getOrCreateSshKey } from "@/lib/sshkey";
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
  // SQLite on a server, automatic: TriLens logs in over SSH. Used for this request only, never stored or logged.
  z.object({
    ssh: z.object({
      host: z.string().trim().min(3).max(255),
      port: z.coerce.number().int().min(1).max(65535).optional(),
      username: z.string().trim().min(1).max(64),
      password: z.string().max(512).optional(),
      privateKey: z.string().max(20_000).optional(),
      passphrase: z.string().max(512).optional(),
      // Log in with this user's TriLens access key (added to the server once in hPanel → SSH keys).
      useTrilensKey: z.boolean().optional(),
    }),
    dbPath: z.string().max(1024).optional().nullable(),
  }),
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
  const kind = "url" in body ? "postgres" : "ssh" in body ? "sqlite_ssh" : "sqlite";
  try {
    if ("url" in body) summary = await checkLiveDb(body.url);
    else if ("sqliteReport" in body) summary = parseSqliteReport(body.sqliteReport);
    else {
      const { useTrilensKey, ...login } = body.ssh;
      if (useTrilensKey) {
        const key = await getOrCreateSshKey(user);
        login.privateKey = key.privateKey;
        login.password = undefined;
        login.passphrase = undefined;
      }
      const r = await sshSqlite(login, body.dbPath);
      // First call (no path): list the SQLite files found so the customer can pick one.
      if ("candidates" in r) {
        await logEvent("db_check", user.id, { scanId: scan.id, projectId: project.id, kind, step: "discover", found: r.candidates.length });
        return NextResponse.json({ candidates: r.candidates });
      }
      summary = parseSqliteReport(r.report);
    }
  } catch (err) {
    let msg = err instanceof LiveDbError || err instanceof SqliteReportError || err instanceof SshCheckError ? err.message : "Database check failed";
    if ("ssh" in body && body.ssh.useTrilensKey && /refused the login/.test(msg)) {
      msg = "Your server didn't accept the TriLens access key yet. Add it in Hostinger (VPS → Settings → SSH keys → Add SSH key), save, wait a minute, then try again.";
    }
    if (!(err instanceof SshCheckError || err instanceof LiveDbError || err instanceof SqliteReportError)) console.error("db check failed", kind, (err as Error).message?.slice(0, 200));
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
