import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { parseJsonOutput, runAgent } from "../ai";
import type { PolicyClaims } from "../types";
import type { DocConflict, DocPromise } from "./engine";
import { extractClaims, fetchPolicyText, keywordClaims, MAX_POLICY_CHARS, NO_POLICY } from "./policy";

export const DOC_KINDS = ["privacy", "terms", "engagement", "nda", "dpa", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  privacy: "Privacy policy",
  terms: "Terms and conditions",
  engagement: "Engagement terms",
  nda: "NDA",
  dpa: "Data processing agreement",
  other: "Other document",
};

/** What the report keeps about each document. The full text is not stored on the scan. */
export type ScannedDocument = {
  id: string;
  kind: DocKind;
  title: string;
  url: string | null;
  read: boolean;
  chars: number;
  source: "agent" | "keywords" | "none";
  promises: DocPromise[];
};

const PromisesSchema = z.object({
  promises: z.array(z.object({
    kind: z.enum(["retention", "deletion", "sharing", "no_sharing", "confidentiality", "storage_location"]),
    text: z.string().min(3).max(400),
  })).default([]),
});
const ConflictsSchema = z.object({
  conflicts: z.array(z.object({
    title: z.string().min(5).max(200),
    docs: z.array(z.string()).min(2).max(4),
    detail: z.string().max(500),
    severity: z.enum(["high", "medium", "low"]).default("medium"),
  })).default([]),
});

const SENTENCE = /(?<=[.!?])\s+|\n+/;

/** Keyword fallback when the agent is unavailable. */
function keywordPromises(title: string, text: string): DocPromise[] {
  const out: DocPromise[] = [];
  for (const s of text.split(SENTENCE).map((x) => x.trim()).filter((x) => x.length > 20 && x.length < 400)) {
    if (/\b(delete|destroy|erase|return)\b.{0,80}\b(within|after|upon|on (termination|completion|expiry))\b/i.test(s)) out.push({ doc: title, kind: "deletion", text: s });
    else if (/\b(retain|retention|keep|stored? for)\b.{0,60}\b(\d+\s*(day|month|year)s?|years?|months?)\b/i.test(s)) out.push({ doc: title, kind: "retention", text: s });
    else if (/\b(not|never|no)\b.{0,40}\b(share|disclose|sell|transfer)\b.{0,60}\b(third part|anyone|any person|others)/i.test(s)) out.push({ doc: title, kind: "no_sharing", text: s });
    else if (/\b(stored|hosted|processed|kept)\b.{0,40}\b(in|within) (india|the eu|the european|the united states|the us|your country)\b/i.test(s)) out.push({ doc: title, kind: "storage_location", text: s });
    if (out.length >= 8) break;
  }
  return out;
}

async function extractPromises(title: string, text: string): Promise<{ promises: DocPromise[]; source: "agent" | "keywords" }> {
  const run = await runAgent(process.env.AGENTICORG_READER_AGENT_ID, "extract_doc_promises", { document_title: title, document_text: text.slice(0, MAX_POLICY_CHARS) }, 45_000);
  if (run && !run.error) {
    const parsed = PromisesSchema.safeParse(parseJsonOutput(run.output));
    if (parsed.success) return { promises: parsed.data.promises.slice(0, 12).map((p) => ({ ...p, doc: title })), source: "agent" };
  }
  return { promises: keywordPromises(title, text), source: "keywords" };
}

/** Ask the agent to compare what the documents promise; only when two or more documents were read. */
async function findConflicts(docs: ScannedDocument[]): Promise<DocConflict[]> {
  const read = docs.filter((d) => d.read && d.promises.length);
  if (read.length < 2) return [];
  const run = await runAgent(process.env.AGENTICORG_REVIEWER_AGENT_ID, "compare_documents", {
    documents: read.map((d) => ({ title: d.title, kind: DOC_KIND_LABEL[d.kind], promises: d.promises.map((p) => ({ kind: p.kind, text: p.text })) })),
  }, 45_000);
  if (!run || run.error) return [];
  const parsed = ConflictsSchema.safeParse(parseJsonOutput(run.output));
  return parsed.success ? parsed.data.conflicts.slice(0, 6) : [];
}

function mergeClaims(list: PolicyClaims[]): PolicyClaims {
  const real = list.filter((c) => !c.noPolicy);
  if (!real.length) return { ...NO_POLICY };
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  return {
    collected: uniq(real.flatMap((c) => c.collected)),
    purposes: uniq(real.flatMap((c) => c.purposes)),
    thirdParties: uniq(real.flatMap((c) => c.thirdParties)),
    retention: real.find((c) => c.retention)?.retention ?? null,
    crossBorder: real.find((c) => c.crossBorder)?.crossBorder ?? null,
    noPolicy: false,
  };
}

export type DocumentsResult = {
  documents: ScannedDocument[];
  /** Claims from every privacy policy, merged; null when the project has no privacy documents. */
  claims: PolicyClaims | null;
  claimsSource: "agent" | "keywords" | "none";
  promises: DocPromise[];
  conflicts: DocConflict[];
};

/** Read every legal document attached to a project. Never throws. */
export async function readProjectDocuments(projectId: string): Promise<DocumentsResult | null> {
  const rows = await db.select().from(schema.documents).where(eq(schema.documents.projectId, projectId));
  if (!rows.length) return null;

  const documents: ScannedDocument[] = [];
  const privacyClaims: PolicyClaims[] = [];
  let claimsSource: DocumentsResult["claimsSource"] = "none";

  await Promise.all(rows.map(async (row) => {
    const kind = (DOC_KINDS as readonly string[]).includes(row.kind) ? (row.kind as DocKind) : "other";
    const text = row.text?.trim() ? row.text.slice(0, MAX_POLICY_CHARS) : row.url ? await fetchPolicyText(row.url) : null;
    if (!text) {
      documents.push({ id: row.id, kind, title: row.title, url: row.url, read: false, chars: 0, source: "none", promises: [] });
      return;
    }
    const [{ promises, source }, claims] = await Promise.all([
      extractPromises(row.title, text),
      kind === "privacy" ? extractClaims(text) : Promise.resolve(null),
    ]);
    if (claims) {
      privacyClaims.push(claims.claims);
      if (claims.source === "agent" || claimsSource === "none") claimsSource = claims.source;
    } else if (kind === "terms" || kind === "dpa") {
      // Terms and DPAs often name data and processors too; let them count towards disclosure.
      privacyClaims.push(keywordClaims(text));
    }
    documents.push({ id: row.id, kind, title: row.title, url: row.url, read: true, chars: text.length, source, promises });
  }));

  documents.sort((a, b) => DOC_KINDS.indexOf(a.kind) - DOC_KINDS.indexOf(b.kind));
  const conflicts = await findConflicts(documents);
  return {
    documents,
    claims: documents.some((d) => d.kind === "privacy") ? mergeClaims(privacyClaims) : null,
    claimsSource,
    promises: documents.flatMap((d) => d.promises),
    conflicts,
  };
}
