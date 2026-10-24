import type { CodeFinding, DbFinding, Framework, Gap, PolicyClaims, SchemaFinding } from "../types";
import type { Project, Scan } from "../db/schema";

// What the app collects and who receives it, computed from a scan's findings.
// The widget, hosted pages and the policy generator all read from this.

export type VendorInfo = { name: string; region: "us" | "eu" | "in" | "unknown"; dataTypes: string[]; category: string };

export type Inventory = {
  dataTypes: string[];
  vendors: VendorInfo[];
  frameworks: Framework[];
  usesAi: boolean;
  hasAnalytics: boolean;
  hasVectorStore: boolean;
  piiTables: string[];
};

export const DATA_TYPE_LABELS: Record<string, string> = {
  email: "Email address",
  phone: "Phone number",
  ip: "IP address",
  address: "Postal address",
  chat_history: "Chat messages and conversation history",
  device: "Device and browser information",
  aadhaar: "Aadhaar number",
  pan: "PAN (Permanent Account Number)",
  name: "Name",
  dob: "Date of birth",
  gender: "Gender",
  location: "Location (latitude/longitude)",
  payment: "Payment information",
  embeddings: "Text embeddings derived from your messages",
};

export function labelFor(dataType: string): string {
  return DATA_TYPE_LABELS[dataType] ?? dataType.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/openai|anthropic|claude|gemini|generative|genai|langchain|cohere|mistral|groq/i, "AI model provider"],
  [/posthog|mixpanel|google.?analytics|gtag|react-ga|segment|amplitude|hotjar|meta.?pixel|facebook/i, "Product analytics"],
  [/sentry|bugsnag|datadog|logrocket/i, "Error monitoring"],
  [/pinecone|weaviate|pgvector|qdrant|chroma/i, "Vector database"],
  [/firebase|supabase|vercel|aws|gcp|mongodb/i, "Hosting and database"],
  [/resend|sendgrid|nodemailer|mailgun|postmark/i, "Email delivery"],
  [/twilio|msg91|whatsapp/i, "SMS and messaging"],
  [/stripe|razorpay|pine.?labs|paypal|cashfree/i, "Payments"],
];

export function vendorCategory(name: string, kind?: CodeFinding["kind"]): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat;
  return kind === "llm_call" ? "AI model provider" : "Service provider";
}

export function isAnalyticsVendor(name: string): boolean {
  return vendorCategory(name) === "Product analytics";
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export type ScanParts = {
  codeFindings: CodeFinding[];
  schemaFindings: SchemaFinding[];
  dbFindings: DbFinding[];
  gaps: Gap[];
  claims: PolicyClaims | null;
};

export function scanParts(scan: Scan): ScanParts {
  return {
    codeFindings: arr<CodeFinding>(scan.codeFindings),
    schemaFindings: arr<SchemaFinding>(scan.schemaFindings),
    dbFindings: arr<DbFinding>(scan.dbFindings),
    gaps: arr<Gap>(scan.gaps),
    claims: (scan.policyClaims as PolicyClaims | null) ?? null,
  };
}

const TYPE_ORDER = Object.keys(DATA_TYPE_LABELS);

export function computeInventory(parts: Pick<ScanParts, "codeFindings" | "schemaFindings" | "dbFindings">, frameworks: Framework[]): Inventory {
  const types = new Set<string>();
  const vendors = new Map<string, VendorInfo>();
  const piiTables = new Set<string>();
  let usesAi = false;
  let hasVectorStore = false;

  for (const f of parts.codeFindings) {
    for (const t of f.dataTypes ?? []) types.add(t);
    if (f.kind === "llm_call") usesAi = true;
    if (f.vendor) {
      const key = f.vendor.toLowerCase();
      const v = vendors.get(key) ?? { name: f.vendor, region: f.region ?? "unknown", dataTypes: [], category: vendorCategory(f.vendor, f.kind) };
      for (const t of f.dataTypes ?? []) if (!v.dataTypes.includes(t)) v.dataTypes.push(t);
      if (v.region === "unknown" && f.region) v.region = f.region;
      if (v.category === "AI model provider") usesAi = true;
      vendors.set(key, v);
    }
  }
  for (const s of parts.schemaFindings) {
    for (const t of s.dataTypes ?? []) types.add(t);
    if (s.kind === "pii_column") piiTables.add(s.table);
    if (s.kind === "vector_store") {
      hasVectorStore = true;
      types.add("embeddings");
    }
  }
  for (const d of parts.dbFindings) {
    if (d.kind === "pii_column") piiTables.add(d.table);
  }

  const dataTypes = [...types].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const vendorList = [...vendors.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    dataTypes,
    vendors: vendorList,
    frameworks,
    usesAi,
    hasAnalytics: vendorList.some((v) => isAnalyticsVendor(v.name)),
    hasVectorStore,
    piiTables: [...piiTables].sort(),
  };
}

export function projectFrameworks(project: Pick<Project, "frameworks">): Framework[] {
  const order: Framework[] = ["DPDP", "GDPR", "CCPA"];
  const fw = (project.frameworks ?? []) as string[];
  const list = order.filter((f) => fw.includes(f));
  return list.length ? list : ["GDPR"];
}
