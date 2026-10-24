import type { SchemaFinding } from "../types";
import type { RepoFile } from "./files";
import { classifyName } from "./pii";

type Table = { name: string; aliases: string[]; file: string; line: number; columns: { name: string; type: string; line: number }[] };

const VECTOR_TYPE = /vector\s*\(|Unsupported\(\s*"vector|\bvector\b|halfvec/i;

function parsePrisma(f: RepoFile): Table[] {
  const tables: Table[] = [];
  const lines = f.text.split("\n");
  let cur: Table | null = null;
  lines.forEach((l, i) => {
    const start = l.match(/^\s*model\s+(\w+)\s*\{/);
    if (start) { cur = { name: start[1], aliases: [start[1]], file: f.rel, line: i + 1, columns: [] }; tables.push(cur); return; }
    if (!cur) return;
    if (/^\s*\}/.test(l)) { cur = null; return; }
    const map = l.match(/@@map\(\s*"([^"]+)"/);
    if (map) { cur.aliases.push(map[1]); return; }
    const col = l.match(/^\s*(\w+)\s+([\w]+(?:\([^)]*\))?[\[\]?]*)/);
    if (col && !col[1].startsWith("@@")) cur.columns.push({ name: col[1], type: col[2], line: i + 1 });
  });
  return tables;
}

function parseSql(f: RepoFile): Table[] {
  const tables: Table[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?)\s*\(/gi;
  for (const m of f.text.matchAll(re)) {
    const name = m[2];
    const startIdx = m.index! + m[0].length;
    // find the matching close paren
    let depth = 1, j = startIdx;
    while (j < f.text.length && depth > 0) { const c = f.text[j]; if (c === "(") depth++; else if (c === ")") depth--; j++; }
    const body = f.text.slice(startIdx, j - 1);
    const baseLine = f.text.slice(0, m.index!).split("\n").length;
    const t: Table = { name, aliases: [name], file: f.rel, line: baseLine, columns: [] };
    let offset = startIdx;
    for (const part of body.split(/,(?![^()]*\))/)) {
      const cm = part.match(/^\s*["`]?(\w+)["`]?\s+([\w ]+(?:\([^)]*\))?)/);
      const line = f.text.slice(0, offset + part.search(/\S|$/)).split("\n").length;
      offset += part.length + 1;
      if (!cm || /^(primary|foreign|constraint|unique|check|key|index)$/i.test(cm[1])) continue;
      t.columns.push({ name: cm[1], type: cm[2].trim(), line });
    }
    tables.push(t);
  }
  return tables;
}

function parseDrizzle(f: RepoFile): Table[] {
  const tables: Table[] = [];
  const lines = f.text.split("\n");
  let cur: Table | null = null;
  let depth = 0;
  lines.forEach((l, i) => {
    const start = l.match(/(?:const|let)\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\(\s*["'`](\w+)["'`]/);
    if (start) { cur = { name: start[2], aliases: [start[2], start[1]], file: f.rel, line: i + 1, columns: [] }; tables.push(cur); depth = 0; }
    if (!cur) return;
    const col = l.match(/^\s*(\w+)\s*:\s*(\w+)\(\s*(?:["'`](\w+)["'`])?/);
    if (col && !start) cur.columns.push({ name: col[3] ?? col[1], type: col[2] + (/vector\s*\(/.test(l) ? "(vector)" : ""), line: i + 1 });
    depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
    if (depth <= 0 && !start) cur = null;
    if (start && depth <= 0 && /\)\s*;?\s*$/.test(l)) cur = null;
  });
  return tables;
}

function parseMongoose(f: RepoFile): Table[] {
  const tables: Table[] = [];
  const m = f.text.match(/mongoose\.model\(\s*["'](\w+)["']/);
  if (!m || !/new\s+(?:mongoose\.)?Schema\s*\(/.test(f.text)) return tables;
  const t: Table = { name: m[1], aliases: [m[1], m[1].toLowerCase() + "s"], file: f.rel, line: 1, columns: [] };
  f.text.split("\n").forEach((l, i) => {
    const c = l.match(/^\s*(\w+)\s*:\s*(\{|String|Number|Date|Boolean|\[|Object|mongoose)/);
    if (c) t.columns.push({ name: c[1], type: c[2], line: i + 1 });
  });
  tables.push(t);
  return tables;
}

export function parseTables(files: RepoFile[]): Table[] {
  const out: Table[] = [];
  for (const f of files) {
    if (f.rel.endsWith(".prisma")) out.push(...parsePrisma(f));
    else if (f.rel.endsWith(".sql")) out.push(...parseSql(f));
    else if (/\.(m?[jt]s)$/.test(f.rel) && /\b(pgTable|mysqlTable|sqliteTable)\(/.test(f.text)) out.push(...parseDrizzle(f));
    else if (/\.(m?[jt]s)$/.test(f.rel) && /mongoose/.test(f.text)) out.push(...parseMongoose(f));
  }
  // merge duplicates (e.g. prisma model + its migration): keep first, union aliases
  const merged = new Map<string, Table>();
  for (const t of out) {
    const key = t.name.toLowerCase();
    const prev = merged.get(key);
    if (prev) prev.aliases.push(...t.aliases.filter((a) => !prev.aliases.includes(a)));
    else merged.set(key, t);
  }
  return [...merged.values()];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hasDeletePath(t: Table, code: string): boolean {
  return t.aliases.some((a) => {
    const lc = a.charAt(0).toLowerCase() + a.slice(1);
    const re = new RegExp(
      [
        `\\.${esc(lc)}\\.(delete|deleteMany)\\s*\\(`, // prisma
        `delete\\s+from\\s+["\`]?(?:\\w+\\.)?["\`]?${esc(a)}["\`]?\\b`, // SQL
        `\\.delete\\(\\s*${esc(a)}\\s*\\)`, // drizzle
        `\\.from\\(\\s*["'\`]${esc(a)}["'\`]\\s*\\)[\\s\\S]{0,40}\\.delete\\(`, // supabase-js
        `${esc(a)}\\.(deleteOne|deleteMany|findByIdAndDelete|findOneAndDelete)\\(`, // mongoose
      ].join("|"),
      "i",
    );
    return re.test(code);
  });
}

function hasTtl(t: Table, code: string): boolean {
  if (t.columns.some((c) => /^(expires?_?at|ttl|expiry|retain_?until|delete_?after)$/i.test(c.name))) return true;
  return t.aliases.some((a) =>
    new RegExp(`cron[\\s\\S]{0,200}delete\\s+from\\s+["\`]?${esc(a)}|expireAfterSeconds`, "i").test(code),
  );
}

/** Parse Prisma, SQL/Supabase migrations, Drizzle and Mongoose schemas into PII / vector / retention findings. */
export function detectSchema(files: RepoFile[]): { findings: SchemaFinding[]; schemaFiles: number } {
  const tables = parseTables(files);
  const code = files.filter((f) => !f.rel.endsWith(".prisma")).map((f) => f.text).join("\n");
  const findings: SchemaFinding[] = [];
  for (const t of tables) {
    const tableTypes = new Set<string>();
    let isVector = false;
    for (const c of t.columns) {
      if (VECTOR_TYPE.test(c.type)) {
        isVector = true;
        findings.push({ table: t.name, column: c.name, dataTypes: ["chat_history"], kind: "vector_store", file: t.file, line: c.line });
        tableTypes.add("chat_history");
        continue;
      }
      const types = classifyName(c.name, "column", t.name);
      if (!types.length) continue;
      types.forEach((d) => tableTypes.add(d));
      findings.push({ table: t.name, column: c.name, dataTypes: types, kind: "pii_column", file: t.file, line: c.line });
    }
    if (!tableTypes.size && !isVector) continue;
    const dts = [...tableTypes];
    if (!hasDeletePath(t, code)) findings.push({ table: t.name, dataTypes: dts, kind: "no_delete_path", file: t.file, line: t.line });
    if (!hasTtl(t, code)) findings.push({ table: t.name, dataTypes: dts, kind: "no_ttl", file: t.file, line: t.line });
  }
  const schemaFiles = new Set(tables.map((t) => t.file)).size;
  return { findings, schemaFiles };
}
