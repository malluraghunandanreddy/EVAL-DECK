import type { CodeFinding } from "../types";
import { SDK_CATALOG, sdkForPackage, type SdkEntry } from "./catalog";
import type { RepoFile } from "./files";
import { classifyLine } from "./pii";

const CODE_EXT = /\.(m?[jt]sx?|cjs|py|vue|svelte|html?)$/i;
const isCode = (rel: string) => CODE_EXT.test(rel);
const isHtml = (rel: string) => /\.html?$/i.test(rel);

/**
 * HTML pages are mostly prose. Only lines inside <script> blocks, or lines carrying form controls, count as
 * code for PII and vendor detection; marketing copy that mentions "Aadhaar" or shows an OpenAI code sample
 * in a <pre> must not become a finding. Returns one flag per line.
 */
/** Drop sentence-like string literals (3+ spaces, 25+ chars) so UI copy and mock data inside scripts are not read as PII handling. */
function stripProseLiterals(line: string): string {
  return line.replace(/(["'`“])([^"'`”]{25,})(["'`”])/g, (m, q, body) => (body.split(" ").length >= 4 ? `${q}…${q}` : m));
}

function htmlCodeLines(lines: string[]): boolean[] {
  const flags = new Array<boolean>(lines.length).fill(false);
  let inScript = false;
  let inPre = false;
  lines.forEach((l, i) => {
    if (/<pre\b|<code\b/i.test(l)) inPre = true;
    const opensScript = /<script\b(?![^>]*type=["'](application\/(ld\+)?json|text\/template)["'])/i.test(l);
    if (opensScript) inScript = true;
    flags[i] = (inScript && !inPre) || /<(input|select|textarea|form)\b/i.test(l);
    if (/<\/script>/i.test(l)) inScript = false;
    if (/<\/pre>|<\/code>/i.test(l)) inPre = false;
  });
  return flags;
}
const isPy = (rel: string) => /\.py$/i.test(rel);

function snippet(line: string): string {
  const s = line.trim();
  return s.length > 160 ? s.slice(0, 157) + "..." : s;
}

/** npm package name from an import specifier ("@sentry/node/x" -> "@sentry/node", "openai/resources" -> "openai"). */
function npmPackage(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;
const PY_IMPORT = /^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+))/;

/** Vendors imported by one source file, with the line of the import. */
function importsIn(file: RepoFile): { sdk: SdkEntry; line: number; text: string }[] {
  const out: { sdk: SdkEntry; line: number; text: string }[] = [];
  const seen = new Set<string>();
  const lines = file.text.split("\n");
  lines.forEach((text, i) => {
    let sdk: SdkEntry | undefined;
    if (isPy(file.rel)) {
      const m = text.match(PY_IMPORT);
      if (m) sdk = sdkForPackage(m[1] ?? m[2], "py");
    } else {
      for (const m of text.matchAll(JS_IMPORT)) {
        const pkg = npmPackage(m[1]);
        sdk = pkg ? sdkForPackage(pkg, "npm") : undefined;
        if (sdk) break;
      }
    }
    if (!sdk) for (const e of SDK_CATALOG) if (e.urls?.test(text)) { sdk = e; break; }
    if (sdk && !seen.has(sdk.id)) {
      seen.add(sdk.id);
      out.push({ sdk, line: i + 1, text });
    }
  });
  return out;
}

/** Vendors declared in manifests (package.json, requirements.txt, pyproject.toml). */
function manifestFindings(files: RepoFile[]): CodeFinding[] {
  const out: CodeFinding[] = [];
  for (const f of files) {
    const base = f.rel.split("/").pop()!;
    const lang = base === "package.json" ? "npm" : base === "requirements.txt" || base === "pyproject.toml" || base === "Pipfile" ? "py" : null;
    if (!lang) continue;
    const seen = new Set<string>();
    f.text.split("\n").forEach((text, i) => {
      const m = lang === "npm" ? text.match(/^\s*"(@?[\w.\-/]+)"\s*:\s*"/) : text.match(/^\s*"?([A-Za-z][\w.\-]*)/);
      if (!m) return;
      const sdk = sdkForPackage(m[1], lang);
      if (!sdk || !sdk.thirdParty || seen.has(sdk.id)) return;
      seen.add(sdk.id);
      out.push({ kind: "third_party", vendor: sdk.vendor, dataTypes: [...sdk.dataTypes], file: f.rel, line: i + 1, snippet: snippet(text), region: sdk.region, summary: sdk.summary });
    });
  }
  return out;
}

const LLM_HISTORY = /histor|chat_?log|conversation|transcript|previous_?messages|past_?messages|all_?messages|\.\.\.\s*messages|messages\s*:\s*[a-zA-Z_]/i;
const LOG_CALL = /\bconsole\.(log|info|debug|warn|error)\s*\(|\blogger\.\w+\s*\(|\blogging\.\w+\s*\(|\bprint\s*\(/;

/** Line range around i, clipped to the enclosing top-level statement (a route handler, function, def). */
function blockWindow(lines: string[], i: number, before: number, after: number): [number, number] {
  const top = (l: string) => /^\S/.test(l) && !/^[})\]]/.test(l);
  let a = i;
  while (a > Math.max(0, i - before) && !top(lines[a])) a--;
  let b = i;
  while (b < Math.min(lines.length - 1, i + after) && !(b > i && /^\S/.test(lines[b]))) b++;
  if (b > i && top(lines[b])) b--;
  return [a, b];
}

function windowTypes(lines: string[], i: number, before: number, after: number): string[] {
  const set = new Set<string>();
  const [a, b] = blockWindow(lines, i, before, after);
  for (let j = a; j <= b; j++) for (const d of classifyLine(lines[j])) set.add(d);
  return [...set];
}

/** Scan source files: vendor usage, LLM calls, PII fields, logging of PII. */
export function detectCode(files: RepoFile[]): CodeFinding[] {
  const findings: CodeFinding[] = manifestFindings(files);
  for (const f of files) {
    if (!isCode(f.rel)) continue;
    const lines = f.text.split("\n");
    const html = isHtml(f.rel);
    const codeish = html ? htmlCodeLines(lines) : null;
    const isCodeLine = (i: number) => !codeish || codeish[i];
    // In HTML only form controls count as collecting personal data; inline scripts still count for vendors and LLM calls.
    const isFieldLine = (i: number) => !html || /<(input|select|textarea)\b/i.test(lines[i]);
    const scanLine = (l: string) => (html ? stripProseLiterals(l) : l);
    const imported = importsIn(f).filter((x) => isCodeLine(x.line - 1));
    const vendorsHere = imported.map((x) => x.sdk);

    // third-party usage: the import itself, enriched with PII seen around each usage call
    for (const { sdk, line, text } of imported) {
      if (!sdk.thirdParty) continue;
      const types = new Set(sdk.dataTypes);
      let at = line;
      let snip = text;
      if (sdk.usage) {
        lines.forEach((l, i) => {
          if (!sdk.usage!.test(l)) return;
          const extra = windowTypes(lines, i, 1, 3).filter((d) => !types.has(d));
          if (extra.length && at === line) { at = i + 1; snip = l; }
          extra.forEach((d) => types.add(d));
        });
      }
      findings.push({ kind: "third_party", vendor: sdk.vendor, dataTypes: [...types], file: f.rel, line: at, snippet: snippet(snip), region: sdk.region, summary: sdk.summary });
    }

    // LLM calls: which provider, and whether chat history / PII goes into the prompt
    const llmVendors = vendorsHere.filter((v) => v.category === "llm");
    if (llmVendors.length) {
      lines.forEach((l, i) => {
        if (!isCodeLine(i)) return;
        const sl = scanLine(l);
        const v = llmVendors.find((x) => x.usage?.test(sl)) ?? (SDK_CATALOG.find((x) => x.id === "openai")!.usage!.test(sl) ? llmVendors[0] : undefined);
        if (!v) return;
        const [a, b] = blockWindow(lines, i, 12, 8);
        const win = lines.slice(a, b + 1).join("\n");
        const types = new Set(windowTypes(lines, i, 12, 8));
        if (LLM_HISTORY.test(win)) types.add("chat_history");
        // provider for langchain wrappers
        const provider = v.thirdParty ? v : (/Anthropic/.test(l) ? SDK_CATALOG.find((x) => x.id === "anthropic")! : /Google/.test(l) ? SDK_CATALOG.find((x) => x.id === "google_ai")! : SDK_CATALOG.find((x) => x.id === "openai")!);
        findings.push({
          kind: "llm_call", vendor: provider.vendor, dataTypes: [...types], file: f.rel, line: i + 1, snippet: snippet(l), region: provider.region,
          summary: types.has("chat_history") ? `Sends chat history to ${provider.vendor}.` : `Calls ${provider.vendor} with user input.`,
        });
      });
    }

    // PII fields and logging: first occurrence of each data type per file
    const seenTypes = new Set<string>();
    lines.forEach((l, i) => {
      if (!isCodeLine(i) || !isFieldLine(i)) return;
      if (l.length > 400 || /^\s*(\/\/|#|\*)/.test(l)) return;
      const types = classifyLine(scanLine(l));
      if (!types.length) return;
      if (LOG_CALL.test(l)) {
        findings.push({ kind: "logging", dataTypes: types, file: f.rel, line: i + 1, snippet: snippet(l), summary: `Logs ${types.join(", ")}.` });
        return;
      }
      const fresh = types.filter((t) => !seenTypes.has(t));
      if (!fresh.length) return;
      fresh.forEach((t) => seenTypes.add(t));
      findings.push({ kind: "pii_field", dataTypes: fresh, file: f.rel, line: i + 1, snippet: snippet(l) });
    });
  }
  return findings;
}

const DB_ENV = /^(DATABASE_URL|DIRECT_URL|DB_URL|DB_HOST|DB_CONNECTION|POSTGRES\w*|PG(HOST|DATABASE|USER|PORT)|SUPABASE_(URL|DB_URL|DB_PASSWORD|SERVICE_ROLE_KEY)|NEXT_PUBLIC_SUPABASE_URL|NEON_\w*|MONGO(DB)?_(URI|URL)|MYSQL_\w*|\w+_DATABASE_URL)$/;

/** Database connection env var NAMES only (never values) so the UI can suggest the Pro DB check. */
export function detectDbEnvHints(files: RepoFile[]): string[] {
  const names = new Set<string>();
  for (const f of files) {
    const base = f.rel.split("/").pop()!;
    if (/^\.env/.test(base)) {
      for (const l of f.text.split("\n")) {
        const m = l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
        if (m && DB_ENV.test(m[1])) names.add(m[1]);
      }
      continue;
    }
    if (!isCode(f.rel) && !/\.(prisma|toml|ya?ml)$/.test(f.rel)) continue;
    const re = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|os\.environ(?:\.get)?[[(]\s*['"]([A-Z][A-Z0-9_]*)['"]|os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]|env\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/g;
    for (const m of f.text.matchAll(re)) {
      const n = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      if (n && DB_ENV.test(n)) names.add(n);
    }
  }
  return [...names].sort();
}

/** Signals the engine uses to mark items as handled. */
export function detectSignals(files: RepoFile[]) {
  const code = files.filter((f) => isCode(f.rel));
  return {
    consentCaptured: code.some((f) => /consent/i.test(f.text)),
    doNotSellLink: files.some((f) => /do[\s-]not[\s-]sell/i.test(f.text) && !/privacy|policy/i.test(f.rel)),
    hasRetentionJob: files.some((f) => /cron\.schedule|pg_cron|expireAfterSeconds|setInterval\([^)]*delete|@daily|retention_?job/i.test(f.text)),
    hasCi: files.some((f) => /^\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\/|^bitbucket-pipelines\.yml$|^azure-pipelines\.yml$/.test(f.rel)),
    hasTests: files.some((f) => /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/.test(f.rel))
      || files.some((f) => /(^|\/)package\.json$/.test(f.rel) && /"test"\s*:\s*"(?!echo \\"Error: no test)/.test(f.text)),
    secrets: detectSecrets(files),
  };
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "Private key"],
  [/\bsk_live_[0-9a-zA-Z]{16,}/, "Stripe live secret key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsk-(proj-)?[A-Za-z0-9]{32,}/, "OpenAI API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, "GitHub token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/postgres(ql)?:\/\/[^:\s"'`]+:[^@\s"'`$]{6,}@(?!localhost|127\.0\.0\.1|host|db\b)/, "Database URL with password"],
];

/** Hard-coded credentials and committed .env files. Example/sample env files are ignored. */
function detectSecrets(files: RepoFile[]): { file: string; line: number; kind: string }[] {
  const out: { file: string; line: number; kind: string }[] = [];
  for (const f of files) {
    if (/\.(example|sample|template|dist)$|example|sample/i.test(f.rel)) continue;
    const base = f.rel.split("/").pop() ?? "";
    if (/^\.env(\.[\w-]+)?$/.test(base) && /^[A-Z0-9_]+=\S{8,}/m.test(f.text)) {
      out.push({ file: f.rel, line: 1, kind: "Environment file with values" });
      continue;
    }
    const lines = f.text.split("\n");
    for (let i = 0; i < lines.length && out.length < 20; i++) {
      for (const [re, kind] of SECRET_PATTERNS) {
        if (re.test(lines[i])) { out.push({ file: f.rel, line: i + 1, kind }); break; }
      }
    }
  }
  return out;
}
