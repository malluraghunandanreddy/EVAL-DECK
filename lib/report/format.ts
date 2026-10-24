import type {
  ChecklistItem,
  ChecklistStatus,
  CodeFinding,
  Coverage,
  DbFinding,
  Framework,
  Gap,
  PolicyClaims,
  SchemaFinding,
} from "../types";

export type PolicyVersionStatus = "pending_review" | "approved" | "rejected";

export type ScanResponse = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  project: {
    id: string;
    name: string;
    frameworks: Framework[] | null;
    markets: string[] | null;
    repoFullName: string | null;
  } | null;
  isPro: boolean;
  policyClaims: PolicyClaims | null;
  codeFindings: CodeFinding[] | null;
  schemaFindings: SchemaFinding[] | null;
  dbFindings: DbFinding[] | null;
  gaps: Gap[] | null;
  checklist: ChecklistItem[] | null;
  coverage: Coverage | null;
  dbEnvHints?: string[] | null;
  policyVersion?: { status: PolicyVersionStatus; reviewerNote: string | null; siteId: string | null } | null;
};

export type PolicyPreview = { sections: { title: string; md: string }[]; locked: boolean; totalSections: number };

export const FRAMEWORK_ORDER: Framework[] = ["DPDP", "GDPR", "CCPA"];

export const FRAMEWORK_LABEL: Record<Framework, string> = {
  DPDP: "DPDP (India)",
  GDPR: "GDPR (EU/UK)",
  CCPA: "CCPA (US)",
};

export const STATUS_META: Record<ChecklistStatus, { icon: string; label: string }> = {
  done: { icon: "✓", label: "Done" },
  todo: { icon: "✕", label: "To do" },
  not_checked: { icon: "◌", label: "Needs database" },
  manual: { icon: "✎", label: "Check manually" },
};

export const SEVERITIES: Gap["severity"][] = ["high", "medium", "low"];

export const SEVERITY_LABEL: Record<Gap["severity"], string> = { high: "High", medium: "Medium", low: "Low" };

export const LAYER_LABEL: Record<Gap["layer"], string> = {
  policy_vs_code: "Policy vs code",
  code_vs_storage: "Code vs storage",
  policy_vs_storage: "Policy vs storage",
  storage_access: "Storage access",
};

export const COVERAGE_NOTE =
  "Based on code and schema files. Connect your database (read-only) for a fuller check: who can read personal data, row-level security, and PII hidden in columns.";

/** Frameworks present in the checklist, in canonical order, falling back to the project's list. */
export function frameworksOf(items: ChecklistItem[], fallback: Framework[] | null | undefined): Framework[] {
  const set = new Set<Framework>(items.map((i) => i.framework));
  (fallback ?? []).forEach((f) => set.add(f));
  return FRAMEWORK_ORDER.filter((f) => set.has(f));
}

export function evidenceLocation(e: Gap["evidence"][number]): string | null {
  if (e.file) return e.line ? `${e.file}:${e.line}` : e.file;
  if (e.table) return `table ${e.table}`;
  return null;
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

export function arr<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}
