import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyzeDirectory } from "./analyze";
import { keywordClaims } from "./policy";
import { classifyName } from "./pii";
import { stripFixes } from "../checklist";

const FIXTURE = join(__dirname, "..", "..", "scripts", "fixtures", "demo-repo");

test("demo repo: DPDP + GDPR gaps and checklists", async () => {
  const t0 = Date.now();
  const r = await analyzeDirectory(FIXTURE, { frameworks: ["DPDP", "GDPR"] });
  const ms = Date.now() - t0;

  const vendors = new Set(r.codeFindings.filter((f) => f.kind === "third_party").map((f) => f.vendor));
  for (const v of ["OpenAI", "PostHog", "Sentry"]) assert.ok(vendors.has(v), `vendor ${v} detected`);
  assert.ok(!vendors.has("pgvector"), "pgvector is a library, not a third party");

  const llm = r.codeFindings.find((f) => f.kind === "llm_call" && f.vendor === "OpenAI");
  assert.ok(llm?.dataTypes.includes("chat_history"), "chat history sent to OpenAI");

  const posthog = r.codeFindings.filter((f) => f.vendor === "PostHog");
  assert.ok(posthog.some((f) => f.dataTypes.includes("ip")), "PostHog receives IP");

  const cols = r.schemaFindings.filter((f) => f.kind === "pii_column").map((f) => `${f.table}.${f.column}`);
  for (const c of ["User.phone", "User.ip", "User.chatLog", "User.email"]) assert.ok(cols.includes(c), `pii column ${c}`);
  assert.ok(r.schemaFindings.some((f) => f.kind === "vector_store" && f.table === "Embedding"), "vector store");
  assert.ok(r.schemaFindings.some((f) => f.kind === "no_delete_path" && f.table === "User"), "no delete path on User");
  assert.ok(r.schemaFindings.some((f) => f.kind === "no_ttl" && f.table === "User"), "no ttl on User");

  assert.deepEqual(r.dbEnvHints, ["DATABASE_URL"]);
  assert.equal(r.policyClaims.noPolicy, false);
  assert.deepEqual(r.policyClaims.thirdParties, []);
  assert.ok(r.policyClaims.collected.includes("email") && r.policyClaims.collected.includes("name"));
  assert.ok(!r.policyClaims.collected.includes("phone"));

  assert.ok(r.gaps.length >= 5, `>=5 gaps, got ${r.gaps.length}`);
  for (const g of r.gaps) {
    assert.ok(g.law.length > 0, `gap ${g.id} cites law`);
    assert.ok(g.checklistIds.length > 0, `gap ${g.id} maps to checklist`);
    assert.ok(g.frameworks.every((f) => f === "DPDP" || f === "GDPR"), `gap ${g.id} frameworks limited`);
    assert.ok(g.fix, `gap ${g.id} has fix`);
  }
  const ids = r.gaps.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "gap ids unique");
  for (const id of ["undisclosed_data:phone", "undisclosed_vendor:openai", "llm_minimisation:openai", "cross_border:posthog", "no_delete_path:user", "vector_store:embedding"])
    assert.ok(ids.includes(id), `gap ${id}`);
  assert.ok(!ids.some((id) => id.startsWith("ccpa_")), "no CCPA-only gaps when CCPA not selected");

  const todo = (fw: string) => r.checklist.filter((i) => i.framework === fw && i.status === "todo").length;
  assert.ok(todo("DPDP") >= 4, `DPDP todo ${todo("DPDP")}`);
  assert.ok(todo("GDPR") >= 4, `GDPR todo ${todo("GDPR")}`);
  assert.ok(!r.checklist.some((i) => i.framework === "CCPA"));
  assert.equal(r.checklist.find((i) => i.id === "dpdp_security")?.status, "not_checked");
  assert.deepEqual(r.coverage, { code: true, schemaFiles: true, liveDb: false });

  // stable ids across re-scans
  const again = await analyzeDirectory(FIXTURE, { frameworks: ["DPDP", "GDPR"] });
  assert.deepEqual(again.gaps.map((g) => g.id), ids);

  // free tier stripping
  assert.ok(stripFixes(r.gaps).every((g) => !("fix" in g)));
  assert.ok(stripFixes(r.checklist).every((i) => !("fix" in i)));

  assert.ok(ms < 60_000, `took ${ms} ms`);
  console.log(`demo repo: ${r.gaps.length} gaps, DPDP todo ${todo("DPDP")}, GDPR todo ${todo("GDPR")}, ${ms} ms`);
});

test("CCPA adds do-not-sell gap for analytics", async () => {
  const r = await analyzeDirectory(FIXTURE, { frameworks: ["CCPA"] });
  assert.ok(r.gaps.some((g) => g.id === "ccpa_sale_share:posthog"));
  assert.equal(r.checklist.find((i) => i.id === "ccpa_opt_out")?.status, "todo");
});

test("no policy -> one high gap per framework", async () => {
  const r = await analyzeDirectory(FIXTURE, { frameworks: ["DPDP", "GDPR"], claims: keywordClaims(null) });
  assert.ok(r.gaps.some((g) => g.id === "no_policy:dpdp" && g.severity === "high"));
  assert.ok(r.gaps.some((g) => g.id === "no_policy:gdpr" && g.severity === "high"));
});

test("name classification", () => {
  assert.deepEqual(classifyName("ipAddress"), ["ip"]);
  assert.deepEqual(classifyName("email_address"), ["email"]);
  assert.ok(classifyName("mobile_number").includes("phone"));
  assert.deepEqual(classifyName("name", "column", "products"), []);
  assert.deepEqual(classifyName("name", "column", "users"), ["name"]);
  assert.deepEqual(classifyName("aadhaar_no"), ["aadhaar"]);
});

test("SOC 2: checklist, repo controls and document promises", async () => {
  const r = await analyzeDirectory(FIXTURE, { frameworks: ["DPDP", "SOC2"] });
  const soc2 = r.checklist.filter((i) => i.framework === "SOC2");
  assert.ok(soc2.length >= 10, `SOC 2 checklist has ${soc2.length} items`);
  assert.ok(soc2.some((i) => i.id === "soc2_vendor_mgmt" && i.status === "todo"), "vendor management flagged (PostHog/OpenAI undisclosed)");
  assert.ok(soc2.some((i) => i.id === "soc2_disposal" && i.status === "todo"), "disposal flagged (no TTL)");
  for (const g of r.gaps) assert.ok(g.frameworks.every((f) => f === "DPDP" || f === "SOC2"), `gap ${g.id} only uses selected frameworks`);

  // DPDP-only scans never show SOC 2-only gaps such as change control.
  const dpdpOnly = await analyzeDirectory(FIXTURE, { frameworks: ["DPDP"] });
  assert.ok(!dpdpOnly.gaps.some((g) => g.id === "no_change_control"), "no SOC 2-only gap without SOC 2");

  const { engineFromFindings } = await import("./evaluate");
  const withDocs = engineFromFindings({
    frameworks: ["SOC2", "GDPR"], codeFindings: r.codeFindings, schemaFindings: r.schemaFindings, claims: r.policyClaims, signals: r.signals,
    coverage: r.coverage,
    docPromises: [{ doc: "Engagement terms", kind: "deletion", text: "client data is deleted within 30 days of the engagement ending" },
      { doc: "NDA", kind: "no_sharing", text: "we will not disclose confidential information to any third party" }],
    docConflicts: [{ title: "Privacy policy keeps data 12 months but the NDA says 30 days", docs: ["Privacy policy", "NDA"], detail: "12 months vs 30 days", severity: "medium" }],
  });
  assert.ok(withDocs.gaps.some((g) => g.id.startsWith("doc_promise_unenforced:engagement_terms")), "deletion promise checked against code");
  assert.ok(withDocs.gaps.some((g) => g.id.startsWith("doc_promise_sharing:nda")), "no-sharing promise checked against vendors");
  assert.ok(withDocs.gaps.some((g) => g.layer === "doc_vs_doc"), "document conflict becomes a gap");
  assert.ok(withDocs.checklist.some((i) => i.id === "soc2_documents_consistent" && i.status === "todo"), "SOC 2 documents item flagged");
});
