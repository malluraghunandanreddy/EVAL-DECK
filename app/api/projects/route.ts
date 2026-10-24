import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema, logEvent } from "@/lib/db";
import { getUser } from "@/lib/session";
import { frameworksFor, type Market } from "@/lib/types";

export const dynamic = "force-dynamic";

const MARKETS = ["IN", "EU", "UK", "US", "OTHER"] as const;

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  markets: z.array(z.enum(MARKETS)).min(1),
  policyUrl: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//i.test(v), "Policy URL must start with http:// or https://"),
  repoFullName: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Repo must look like owner/name")
    .optional()
    .nullable(),
  defaultBranch: z.string().trim().max(255).optional().nullable(),
  source: z.enum(["github", "zip"]).default("github"),
});

// POST /api/projects -> create a project for the signed-in user
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues.map((i) => i.message).join("; ") : "Invalid JSON";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (body.source === "github" && !body.repoFullName) {
    return NextResponse.json({ error: "Pick a repository" }, { status: 400 });
  }

  const frameworks = frameworksFor(body.markets as Market[]);
  const [project] = await db
    .insert(schema.projects)
    .values({
      userId: user.id,
      name: body.name,
      markets: body.markets,
      frameworks,
      policyUrl: body.policyUrl,
      repoFullName: body.repoFullName ?? null,
      defaultBranch: body.defaultBranch ?? null,
      source: body.source,
    })
    .returning();

  await logEvent("onboarded", user.id, {
    project_id: project.id,
    name: project.name,
    markets: body.markets,
    frameworks,
    repo: project.repoFullName,
    has_policy_url: Boolean(project.policyUrl),
  });

  return NextResponse.json({ project }, { status: 201 });
}

// GET /api/projects            -> my projects with their latest scan
// GET /api/projects?id=<uuid>  -> just that project (used by onboarding to find the scan it started)
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  const where = id
    ? and(eq(schema.projects.userId, user.id), eq(schema.projects.id, id))
    : eq(schema.projects.userId, user.id);
  const projects = await db.select().from(schema.projects).where(where).orderBy(desc(schema.projects.createdAt));

  const ids = projects.map((p) => p.id);
  const scans = ids.length
    ? await db
        .select({
          id: schema.scans.id,
          projectId: schema.scans.projectId,
          status: schema.scans.status,
          createdAt: schema.scans.createdAt,
          finishedAt: schema.scans.finishedAt,
        })
        .from(schema.scans)
        .where(inArray(schema.scans.projectId, ids))
        .orderBy(desc(schema.scans.createdAt))
    : [];
  const latest = new Map<string, (typeof scans)[number]>();
  for (const s of scans) if (!latest.has(s.projectId)) latest.set(s.projectId, s);

  return NextResponse.json({
    projects: projects.map((p) => ({ ...p, latestScan: latest.get(p.id) ?? null })),
  });
}
