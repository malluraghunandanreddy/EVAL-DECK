import postgres from "postgres";
import type { DbFinding } from "../types";
import { classifyName, classifyText } from "./pii";

/**
 * Read-only live database check (Supabase / any Postgres). Runs inside one READ ONLY transaction:
 * lists columns, row-level security and SELECT grants, then samples up to SAMPLE_ROWS rows of the
 * PII-looking columns to confirm real values are present. Nothing from the database is stored or
 * sent to an AI: findings carry table/column names and counts only.
 */
export const SAMPLE_ROWS = 20;
const MAX_SAMPLED_TABLES = 10;
const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast", "auth", "storage", "extensions", "realtime", "supabase_functions", "supabase_migrations", "vault", "graphql", "graphql_public", "net", "pgsodium", "pgsodium_masks", "cron", "_realtime", "_analytics", "pgbouncer"];
const BROAD_ROLES = new Set(["anon", "PUBLIC", "public"]);

export type LiveDbSummary = {
  tables: number;
  columns: number;
  piiColumns: number;
  rlsOff: string[];
  broadRead: string[];
  sampledRows: number;
  findings: DbFinding[];
};

export class LiveDbError extends Error {}

export function validateDbUrl(raw: string): string {
  const url = raw.trim();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new LiveDbError("That does not look like a Postgres connection string.");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new LiveDbError("The connection string must start with postgresql://");
  if (!u.hostname) throw new LiveDbError("The connection string has no host.");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "::1") {
    throw new LiveDbError("Private or local database hosts cannot be reached from TriLens.");
  }
  if (!u.password) throw new LiveDbError("Include the database password in the connection string (Supabase: Connect → Transaction pooler → copy, then replace [YOUR-PASSWORD]).");
  if (/\[YOUR-PASSWORD\]/i.test(url)) throw new LiveDbError("Replace [YOUR-PASSWORD] with the real database password.");
  return url;
}

type Col = { schema: string; table: string; column: string; type: string };

export async function checkLiveDb(rawUrl: string, opts: { timeoutMs?: number } = {}): Promise<LiveDbSummary> {
  const url = validateDbUrl(rawUrl);
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, ssl: "prefer", connection: { application_name: "trilens-readonly-check" } });
  const deadline = Date.now() + (opts.timeoutMs ?? 25_000);
  try {
    return await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '8s'`;

      const cols = (await tx<Col[]>`
        select table_schema as schema, table_name as table, column_name as column, data_type as type
        from information_schema.columns
        where table_schema not in ${tx(SYSTEM_SCHEMAS)}
        order by table_schema, table_name, ordinal_position`) as Col[];

      const rls = (await tx<{ schema: string; table: string; rls: boolean }[]>`
        select n.nspname as schema, c.relname as table, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname not in ${tx(SYSTEM_SCHEMAS)}`) as { schema: string; table: string; rls: boolean }[];

      const grants = (await tx<{ schema: string; table: string; grantee: string }[]>`
        select table_schema as schema, table_name as table, grantee
        from information_schema.role_table_grants
        where privilege_type = 'SELECT' and table_schema not in ${tx(SYSTEM_SCHEMAS)}
          and grantee in ('anon', 'authenticated', 'PUBLIC')`) as { schema: string; table: string; grantee: string }[];

      const key = (s: string, t: string) => `${s}.${t}`;
      const label = (s: string, t: string) => (s === "public" ? t : `${s}.${t}`);
      const piiByTable = new Map<string, { col: Col; types: string[] }[]>();
      // Only columns that can hold a string of personal data: timestamps, booleans, uuids and numbers never do.
      const STRINGISH = /char|text|json|citext|bytea|xml|array/i;
      for (const c of cols) {
        if (!STRINGISH.test(c.type)) continue;
        const types = classifyName(c.column, "column", c.table);
        if (!types.length) continue;
        const k = key(c.schema, c.table);
        if (!piiByTable.has(k)) piiByTable.set(k, []);
        piiByTable.get(k)!.push({ col: c, types });
      }

      const findings: DbFinding[] = [];
      const rlsOff: string[] = [];
      const broadRead: string[] = [];
      const rlsMap = new Map(rls.map((r) => [key(r.schema, r.table), r.rls]));
      const grantMap = new Map<string, Set<string>>();
      for (const g of grants) {
        const k = key(g.schema, g.table);
        if (!grantMap.has(k)) grantMap.set(k, new Set());
        grantMap.get(k)!.add(g.grantee);
      }

      let sampledRows = 0;
      let sampledTables = 0;
      for (const [k, entries] of piiByTable) {
        const { schema, table } = entries[0].col;
        const name = label(schema, table);
        const hasRls = rlsMap.get(k) ?? true;
        const roles = [...(grantMap.get(k) ?? [])];
        const broad = roles.filter((r) => BROAD_ROLES.has(r) || (r === "authenticated" && !hasRls));

        // Sample a few rows of the PII columns in memory to confirm live values (never stored).
        let live: string[] = [];
        if (sampledTables < MAX_SAMPLED_TABLES && Date.now() < deadline) {
          sampledTables++;
          try {
            const colNames = entries.slice(0, 12).map((e) => e.col.column);
            const rows = (await tx`select ${tx(colNames)} from ${tx(schema)}.${tx(table)} limit ${SAMPLE_ROWS}`) as Record<string, unknown>[];
            sampledRows += rows.length;
            const seen = new Set<string>();
            for (const row of rows) for (const v of Object.values(row)) if (typeof v === "string") for (const t of classifyText(v)) seen.add(t);
            live = [...seen];
          } catch {
            // no SELECT on this table for the given role: that is itself fine, skip sampling
          }
        }

        for (const e of entries) {
          findings.push({
            table: name,
            column: e.col.column,
            kind: "pii_column",
            dataTypes: e.types,
            detail: `${e.col.type}; looks like ${e.types.join(", ")}${live.length ? `; sample rows contain ${live.join(", ")}` : ""}`,
          });
        }
        if (!hasRls) {
          rlsOff.push(name);
          findings.push({ table: name, kind: "rls_off", roles, detail: `Row-level security is disabled; ${roles.length ? roles.join(", ") + " can" : "any role with SELECT can"} read every row of ${entries.length} personal-data column${entries.length === 1 ? "" : "s"}.` });
        }
        if (broad.length) {
          broadRead.push(name);
          findings.push({ table: name, kind: "broad_read_access", roles: broad, detail: `SELECT is granted to ${broad.join(", ")} on a table holding ${entries.map((e) => e.col.column).slice(0, 5).join(", ")}${entries.length > 5 ? "…" : ""}.` });
        }
      }

      return {
        tables: new Set(cols.map((c) => key(c.schema, c.table))).size,
        columns: cols.length,
        piiColumns: [...piiByTable.values()].reduce((n, e) => n + e.length, 0),
        rlsOff,
        broadRead,
        sampledRows,
        findings,
      };
    });
  } catch (err) {
    if (err instanceof LiveDbError) throw err;
    const msg = String((err as Error).message ?? err);
    if (/password authentication failed/i.test(msg)) throw new LiveDbError("The database rejected the password.");
    if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|timeout|ETIMEDOUT/i.test(msg)) throw new LiveDbError("Could not reach the database host. Supabase: use the Transaction pooler URL (port 6543).");
    if (/Tenant or user not found/i.test(msg)) throw new LiveDbError("Supabase did not recognise the user. Use the pooler URL exactly as shown under Connect → Transaction pooler.");
    throw new LiveDbError(`Database check failed: ${msg.slice(0, 160)}`);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
