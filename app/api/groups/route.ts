import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, schema, logEvent } from "@/lib/db";
import { getUser } from "@/lib/session";
import { frameworksFor, type Market } from "@/lib/types";
import { DOC_KINDS, DOC_KIND_LABEL } from "@/lib/scan/documents";
import { maxReposPerAudit } from "@/lib/groups";

export const dynamic = "force-dynamic";

const MARKETS = ["IN", "EU", "UK", "US", "OTHER"] as const;

const Doc = z.object({
  kind: z.enum(DOC_KINDS),
  title: z.string().trim().max(120).optional(),
  url: z.string().trim().max(2000).optional().nullable().transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//i.test(v), "Document links must start with http:// or https://"),
  text: z.string().max(60_000).optional().nullable().transform((v) => (v && v.trim() ? v : null)),
}).refine((d) => d.url || d.text, "Each document needs a link or pasted text");

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  markets: z.array(z.enum(MARKETS)).min(1),
  soc2: z.boolean().default(false),
  repos: z.array(z.object({
    fullName: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, "Repo must look like owner/name"),
    defaultBranch: z.string().trim().max(255).optional().nullable(),
    name: z.string().trim().min(1).max(120).optional(),
    documents: z.array(Doc).max(8).default([]),
  })).min(1),
  sharedDocuments: z.array(Doc).max(8).default([]),
});

// POST /api/groups -> create a multi-repo audit: one group, one project per repo, its legal documents.
// The client then starts each project's scan with POST /api/projects/:id/scans.
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : "Invalid JSON";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const limit = maxReposPerAudit(user);
  if (body.repos.length > limit) {
    return NextResponse.json({ error: `Your plan scans up to ${limit} repos at a time. Pick ${limit} or fewer, or upgrade to Pro monthly for up to 10.`, limit }, { status: 402 });
  }
  const seen = new Set<string>();
  if (body.repos.some((r) => (seen.has(r.fullName) ? true : (seen.add(r.fullName), false)))) {
    return NextResponse.json({ error: "The same repo was picked twice." }, { status: 400 });
  }

  const frameworks = frameworksFor(body.markets as Market[], { soc2: body.soc2 });
  const [group] = await db.insert(schema.groups).values({ userId: user.id, name: body.name }).returning();

  const projects: { id: string; name: string; repo: string }[] = [];
  for (const r of body.repos) {
    const docs = [...body.sharedDocuments, ...r.documents];
    const privacyUrl = docs.find((d) => d.kind === "privacy" && d.url)?.url ?? null;
    const [project] = await db.insert(schema.projects).values({
      userId: user.id,
      groupId: group.id,
      name: r.name ?? r.fullName.split("/")[1] ?? r.fullName,
      markets: body.markets,
      frameworks,
      policyUrl: privacyUrl,
      repoFullName: r.fullName,
      defaultBranch: r.defaultBranch ?? null,
      source: "github",
    }).returning();
    if (docs.length) {
      await db.insert(schema.documents).values(docs.map((d) => ({
        projectId: project.id, kind: d.kind, title: d.title || DOC_KIND_LABEL[d.kind], url: d.url, text: d.text,
      })));
    }
    projects.push({ id: project.id, name: project.name, repo: r.fullName });
  }

  await logEvent("onboarded", user.id, {
    group_id: group.id, name: body.name, repos: projects.length, markets: body.markets, frameworks,
    documents: body.repos.reduce((n, r) => n + r.documents.length, 0) + body.sharedDocuments.length * projects.length,
  });
  return NextResponse.json({ groupId: group.id, projects }, { status: 201 });
}
