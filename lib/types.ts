export type Framework = "DPDP" | "GDPR" | "CCPA" | "SOC2";
export type Market = "IN" | "EU" | "UK" | "US" | "OTHER";

export const MARKET_FRAMEWORK: Record<Market, Framework> = {
  IN: "DPDP",
  EU: "GDPR",
  UK: "GDPR",
  US: "CCPA",
  OTHER: "GDPR",
};

export const FRAMEWORK_ORDER: Framework[] = ["DPDP", "GDPR", "CCPA", "SOC2"];

/** Laws from the markets, plus SOC 2 when asked for (it is an audit standard, not tied to a market). */
export function frameworksFor(markets: Market[], opts: { soc2?: boolean } = {}): Framework[] {
  const set = new Set<Framework>(markets.map((m) => MARKET_FRAMEWORK[m]).filter(Boolean));
  if (set.size === 0) set.add("GDPR");
  if (opts.soc2) set.add("SOC2");
  return FRAMEWORK_ORDER.filter((f) => set.has(f));
}

export type DataType =
  | "email" | "phone" | "ip" | "address" | "chat_history" | "device"
  | "aadhaar" | "pan" | "name" | "dob" | "gender" | "location" | "payment";

export type CodeFinding = {
  kind: "third_party" | "pii_field" | "logging" | "llm_call";
  vendor?: string;
  dataTypes: string[];
  file: string;
  line: number;
  snippet: string;
  region?: "us" | "eu" | "in" | "unknown";
  summary?: string;
};

export type SchemaFinding = {
  table: string;
  column?: string;
  dataTypes: string[];
  kind: "pii_column" | "vector_store" | "no_ttl" | "no_delete_path";
  file: string;
  line: number;
};

export type DbFinding = {
  table: string;
  column?: string;
  kind: "pii_column" | "broad_read_access" | "rls_off" | "no_ttl";
  roles?: string[];
  dataTypes?: string[];
  detail: string;
  /** Overrides the default fix (used for SQLite files, where access is file permissions, not grants). */
  fix?: string;
};

export type PolicyClaims = {
  collected: string[];
  purposes: string[];
  thirdParties: string[];
  retention: string | null;
  crossBorder: string | null;
  noPolicy: boolean;
};

export type LawRef = { regime: Framework; ref: string; text: string };

export type Gap = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  layer: "policy_vs_code" | "code_vs_storage" | "policy_vs_storage" | "storage_access" | "doc_vs_doc" | "repo_hygiene";
  frameworks: Framework[];
  evidence: { file?: string; line?: number; snippet?: string; table?: string }[];
  law: LawRef[];
  checklistIds: string[];
  fix?: string;
};

export type ChecklistStatus = "done" | "todo" | "not_checked" | "manual";

export type ChecklistItem = {
  id: string;
  framework: Framework;
  title: string;
  lawRef: string;
  status: ChecklistStatus;
  gapIds: string[];
  fix?: string;
};

export type Coverage = { code: boolean; schemaFiles: boolean; liveDb: boolean };
