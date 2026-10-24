import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "out", "coverage", "vendor", "__pycache__", ".venv", "venv",
  ".turbo", ".vercel", ".cache", "target", ".idea", ".vscode", "bower_components",
  // test material is not a production data flow and is full of fake PII (fixtures, mocks, sample rows)
  "fixtures", "__fixtures__", "__mocks__", "mocks", "__tests__", "test", "tests", "spec", "e2e", "cypress", ".storybook", "storybook",
]);
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "poetry.lock", "Pipfile.lock", "Cargo.lock", "composer.lock"]);
const TEXT_EXT = /\.(m?[jt]sx?|cjs|py|prisma|sql|json|toml|txt|md|html?|vue|svelte|ya?ml|cfg|ini|env[\w.-]*)$/i;
export const MAX_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;

export type RepoFile = { rel: string; text: string };

/** True when a repo-relative path should be skipped (used by the tar filter too). */
export function skipPath(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const base = parts[parts.length - 1] ?? "";
  if (LOCKFILES.has(base)) return true;
  if (/\.min\.js$/.test(base)) return true;
  return false;
}

export function isTextFile(rel: string): boolean {
  const base = rel.split(/[\\/]/).pop() ?? "";
  return TEXT_EXT.test(base) || /^\.env/.test(base) || base === "Dockerfile" || base === "requirements.txt";
}

/** Read every text file under dir (skipping vendored/binary/lock files), capped at MAX_FILES. */
export function readRepo(dir: string): RepoFile[] {
  const out: RepoFile[] = [];
  const walk = (d: string) => {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const abs = join(d, e.name);
      const rel = relative(dir, abs).split(sep).join("/");
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
        continue;
      }
      if (!e.isFile() || skipPath(rel) || !isTextFile(rel)) continue;
      try {
        if (statSync(abs).size > MAX_FILE_BYTES) continue;
        const text = readFileSync(abs, "utf8");
        if (text.includes("\u0000")) continue; // binary
        out.push({ rel, text });
      } catch {
        /* unreadable: skip */
      }
    }
  };
  walk(dir);
  return out;
}
