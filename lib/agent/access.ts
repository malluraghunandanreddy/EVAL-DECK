import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { Project, Scan, User } from "../db/schema";
import { safeEqual } from "../crypto";

/** Load a scan + project only if the user owns it. */
export async function ownedScan(scanId: string, user: User): Promise<{ scan: Scan; project: Project } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(scanId)) return null;
  const [row] = await db
    .select({ scan: schema.scans, project: schema.projects })
    .from(schema.scans)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.scans.projectId))
    .where(eq(schema.scans.id, scanId))
    .limit(1);
  if (!row || row.project.userId !== user.id) return null;
  return row;
}

/** Bearer MCP_TOKEN check for the AgenticOrg connector endpoints (Path B). */
export function bearerOk(req: Request): boolean {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return !!got && safeEqual(got, expected);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
