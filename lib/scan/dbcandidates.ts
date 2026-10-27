/**
 * Sorts the SQLite files found on a server so the customer sees their app's database first.
 * Operating-system files, test runs, archives and backups stay available behind "Show more", never deleted or hidden for good.
 */
export type CandidateKind = "app" | "backup" | "test" | "run" | "system";
export type DbCandidate = { path: string; kind: CandidateKind; suggested?: boolean };

const SYSTEM = /^\/(etc|var\/lib\/(command-not-found|packagekit|apt|dpkg|fwupd|snapd|systemd|ufw|ubuntu-advantage|landscape|plocate|mlocate|update-notifier|private|polkit-1|NetworkManager|cloud)|var\/log|lib|opt\/(google|microsoft))\//i;
const BACKUP = /(\/|[._-])(originals?|archive[sd]?|old|backups?|scratch|build|dist|copy|bak|snapshot)([._/-]|$)|before[-_]|v\d+\.\d+\.\d+/i;
const TEST = /(smoke|test|check|sample|fixture|example|demo|dummy|seed|mock|tmp)/i;
// one file per job or run: a runs folder, or an id-like name such as audit_SRL-CPCA-20261001-008.db
const RUN = /\/(runs?|engine-runs|jobs)\/|\/[a-z]+_[A-Z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\.(db|sqlite3?)$/;
const MAIN_NAME = /^(app|main|prod|production|data|database|db|portal|site|store|sqlite)\b/i;

function kindOf(path: string): CandidateKind {
  if (SYSTEM.test(path)) return "system";
  if (BACKUP.test(path)) return "backup";
  const name = path.split("/").pop() ?? "";
  if (TEST.test(name)) return "test";
  if (RUN.test(path)) return "run";
  return "app";
}

/** hints: words from the project's name / repo (e.g. "sadeera-client-portal" → client, portal) to favour the matching file. */
export function rankCandidates(paths: string[], hints: string[] = []): DbCandidate[] {
  const words = hints.flatMap((h) => h.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
  const score = (p: string) => {
    const lower = p.toLowerCase();
    const name = lower.split("/").pop() ?? "";
    let s = 0;
    if (words.some((w) => name.includes(w))) s += 6;
    else if (words.some((w) => lower.includes(w))) s += 3;
    if (MAIN_NAME.test(name)) s += 2;
    if (/\/(data|db|database|storage|var)\//.test(lower)) s += 1;
    return s - p.split("/").length * 0.1;
  };
  const order: CandidateKind[] = ["app", "run", "backup", "test", "system"];
  const list = [...new Set(paths)].map((path) => ({ path, kind: kindOf(path) }));
  list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || score(b.path) - score(a.path) || a.path.localeCompare(b.path));
  const out: DbCandidate[] = list;
  if (out[0]?.kind === "app") out[0].suggested = true;
  return out;
}
