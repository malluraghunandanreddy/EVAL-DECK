import type { DbFinding } from "../types";
import type { LiveDbSummary } from "./livedb";
import { classifyName } from "./pii";
import { parseTables } from "./schema";

/**
 * SQLite databases on a server (e.g. a Hostinger VPS) are files, not network services, so TriLens can't connect to them.
 * The owner runs SQLITE_REPORT_COMMAND on the server instead. It opens the file read-only and prints only structure:
 * table definitions, row counts, the file's permissions and location, and other database or backup files next to it.
 * No row values are read. This parses that report into the same findings as the Postgres check.
 */
export const SQLITE_REPORT_HEADER = "-- trilens sqlite v1";

/** The read-only Python script (stdlib only). argv[1] is the database path. Also sent over SSH by sshsqlite.ts. */
export const SQLITE_REPORT_SCRIPT = `import os, sqlite3, sys
p = os.path.abspath(sys.argv[1]); st = os.stat(p)
with open(p, "rb") as fh: head = fh.read(16)
if head != b"SQLite format 3\\x00":
    kind = "empty" if not head else "text" if head.lstrip()[:1] in (b"{", b"[", b"<", b"#") or head.isascii() else "encrypted"
    print("NOT_SQLITE " + kind, file=sys.stderr); sys.exit(4)
print("${SQLITE_REPORT_HEADER}")
print(f"-- file {oct(st.st_mode & 0o777)[2:]} {st.st_size} {p}")
def opendb(lenient):
    c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    # lenient: a schema written by a newer SQLite than the server's Python still lists its tables (nothing is written)
    if lenient: c.execute("pragma writable_schema=on")
    return c, [r for r in c.execute("select name, sql from sqlite_master where type='table' and name not like 'sqlite_%'")]
try:
    c, tables = opendb(False)
except sqlite3.DatabaseError as e:
    try:
        c, tables = opendb(True)
    except sqlite3.DatabaseError as e2:
        print("SQLITE_ERR " + str(e2), file=sys.stderr); sys.exit(5)
for (n, s) in tables:
    if s: print(s + ";")
for (n, s) in tables:
    try: print(f"-- count {n} " + str(c.execute(f'select count(*) from "{n}"').fetchone()[0]))
    except sqlite3.Error: pass
try: print("-- journal " + c.execute("pragma journal_mode").fetchone()[0])
except sqlite3.Error: pass
d = os.path.dirname(p)
for f in sorted(os.listdir(d)):
    q = os.path.join(d, f)
    if q != p and os.path.isfile(q) and any(x in f.lower() for x in (".db", ".sqlite", ".bak", "backup", ".dump")):
        print(f"-- sibling {oct(os.stat(q).st_mode & 0o777)[2:]} {f}")
`;

export const SQLITE_REPORT_COMMAND = `python3 - /path/to/your-app.db <<'PY'
${SQLITE_REPORT_SCRIPT}PY`;

const WEB_ROOT = /\/(public_html|htdocs|www|html|public|static|wwwroot)(\/|$)/i;
const TTL_COL = /^(expires?_?at|ttl|expiry|retain_?until|delete_?after)$/i;

export class SqliteReportError extends Error {}

export function parseSqliteReport(raw: string): LiveDbSummary {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text.includes(SQLITE_REPORT_HEADER)) {
    throw new SqliteReportError("This doesn't look like the TriLens SQLite report. Run the command shown on this page on your server and paste everything it prints.");
  }
  if (text.length > 400_000) throw new SqliteReportError("The report is too large. Paste only what the command prints.");

  const file = text.match(/^-- file (\d{3}) (\d+) (.+)$/m);
  const mode = file ? parseInt(file[1], 8) : null;
  const path = file?.[3]?.trim() ?? "database file";
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/^-- count (\S+) (\d+)$/gm)) counts.set(m[1].toLowerCase(), Number(m[2]));
  const siblings = [...text.matchAll(/^-- sibling (\d{3}) (.+)$/gm)].map((m) => ({ mode: parseInt(m[1], 8), name: m[2].trim() }));

  const tables = parseTables([{ rel: "sqlite-report.sql", text }]);
  const findings: DbFinding[] = [];
  let columns = 0;
  let piiColumns = 0;
  const piiTables = new Set<string>();

  for (const t of tables) {
    columns += t.columns.length;
    const rows = counts.get(t.name.toLowerCase());
    const tableTypes = new Set<string>();
    for (const c of t.columns) {
      const types = classifyName(c.name, "column", t.name);
      if (!types.length) continue;
      piiColumns++;
      types.forEach((d) => tableTypes.add(d));
      findings.push({
        table: t.name, column: c.name, kind: "pii_column", dataTypes: types,
        detail: `SQLite column ${c.name} (${c.type || "untyped"})${rows !== undefined ? `, table has ${rows} rows` : ""}`,
      });
    }
    if (!tableTypes.size) continue;
    piiTables.add(t.name);
    if (!t.columns.some((c) => TTL_COL.test(c.name)) && (rows ?? 1) > 0) {
      findings.push({ table: t.name, kind: "no_ttl", dataTypes: [...tableTypes], detail: `No expiry column on ${t.name}${rows !== undefined ? ` (${rows} rows kept)` : ""}`,
        fix: `Add a cron job on the server that runs: sqlite3 ${path} "DELETE FROM ${t.name} WHERE created_at < datetime('now','-1 year');" (use your stated retention period).` });
    }
  }

  const broadRead: string[] = [];
  const hasPii = piiTables.size > 0;
  if (mode !== null && hasPii && mode & 0o004) {
    broadRead.push(path);
    findings.push({ table: path.split("/").pop() ?? "database", kind: "broad_read_access", roles: ["every user on the server"],
      detail: `Database file permissions are ${file![1]}: any account on the server can read it. Use chmod 600 (or 640 with the app's group).`,
      fix: `On the server run: chmod 600 ${path} (and the same for its -wal and -shm files), so only the app's user can read it.` });
  }
  if (hasPii && WEB_ROOT.test(path)) {
    broadRead.push(`${path} (web folder)`);
    findings.push({ table: `${path.split("/").pop() ?? "database"} (inside the web folder)`, kind: "broad_read_access", roles: ["anyone on the internet"],
      detail: `The database file is inside a web folder (${path}). If the web server serves that folder, anyone can download it. Move it outside the site root.`,
      fix: `Move the database outside the web folder (for example to /var/lib/yourapp/), update the app's path, and block *.db and *.sqlite in the web server config.` });
  }
  for (const s of siblings.filter((x) => hasPii && x.mode & 0o004).slice(0, 3)) {
    broadRead.push(s.name);
    findings.push({ table: s.name, kind: "broad_read_access", roles: ["every user on the server"],
      detail: `Copy or backup ${s.name} next to the database is readable by every account on the server (permissions ${s.mode.toString(8)}). Delete it or chmod 600.`,
      fix: `Delete ${s.name} if it isn't needed, or run chmod 600 on it and keep backups encrypted and outside the app folder.` });
  }

  return { tables: tables.length, columns, piiColumns, rlsOff: [], broadRead, sampledRows: 0, findings };
}
