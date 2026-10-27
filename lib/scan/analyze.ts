import { buildChecklist } from "../checklist";
import type { ChecklistItem, CodeFinding, Coverage, DbFinding, Framework, Gap, PolicyClaims, SchemaFinding } from "../types";
import { detectCode, detectDbEnvHints, detectSignals } from "./detect";
import { engineFromFindings } from "./evaluate";
import type { DocConflict, DocPromise } from "./engine";
import { readRepo } from "./files";
import { findPolicyInRepo, keywordClaims } from "./policy";
import { detectSchema } from "./schema";

export type AnalyzeOptions = {
  frameworks: Framework[];
  /** Policy text (fetched from the project's URL). If omitted, a PRIVACY.* file in the repo is used. */
  policyText?: string | null;
  /** Pre-extracted claims (e.g. from the Policy Reader agent); overrides policyText. */
  claims?: PolicyClaims;
  dbFindings?: DbFinding[] | null;
  docPromises?: DocPromise[];
  docConflicts?: DocConflict[];
};

export type AnalyzeResult = {
  codeFindings: CodeFinding[];
  schemaFindings: SchemaFinding[];
  policyClaims: PolicyClaims;
  policyText: string | null;
  gaps: Gap[];
  checklist: ChecklistItem[];
  coverage: Coverage;
  dbEnvHints: string[];
  signals: ReturnType<typeof detectSignals>;
};

/** Pure analysis of an extracted repo directory: no network, no DB. */
export async function analyzeDirectory(dir: string, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const files = readRepo(dir);
  const codeFindings = detectCode(files);
  const { findings: schemaFindings, schemaFiles } = detectSchema(files);
  const dbEnvHints = detectDbEnvHints(files);
  const signals = detectSignals(files);
  const policyText = opts.policyText ?? findPolicyInRepo(files);
  const policyClaims = opts.claims ?? keywordClaims(policyText);
  const coverage: Coverage = { code: true, schemaFiles: schemaFiles > 0, liveDb: !!opts.dbFindings };
  const { gaps, checklist } = engineFromFindings({
    frameworks: opts.frameworks, codeFindings, schemaFindings, dbFindings: opts.dbFindings ?? null, claims: policyClaims, signals, coverage,
    docPromises: opts.docPromises, docConflicts: opts.docConflicts,
  });
  return { codeFindings, schemaFindings, policyClaims, policyText, gaps, checklist, coverage, dbEnvHints, signals };
}

export { buildChecklist };
