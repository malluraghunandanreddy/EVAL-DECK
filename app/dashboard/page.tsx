import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  queued: "var(--muted)",
  running: "var(--warn)",
  done: "var(--good)",
  failed: "var(--bad)",
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ upgraded?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/api/auth/github");
  const { upgraded } = await searchParams;

  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id))
    .orderBy(desc(schema.projects.createdAt));
  const ids = projects.map((p) => p.id);
  const scans = ids.length
    ? await db
        .select({ id: schema.scans.id, projectId: schema.scans.projectId, status: schema.scans.status, createdAt: schema.scans.createdAt })
        .from(schema.scans)
        .where(inArray(schema.scans.projectId, ids))
        .orderBy(desc(schema.scans.createdAt))
    : [];
  const latest = new Map<string, (typeof scans)[number]>();
  for (const s of scans) if (!latest.has(s.projectId)) latest.set(s.projectId, s);

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>Your apps</h1>
          {user.isPro ? (
            <span style={{ background: "var(--good)", color: "#06140d", borderRadius: 6, padding: "2px 8px", fontWeight: 700, fontSize: 12 }}>
              PRO
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>Free plan</span>
          )}
        </div>
        <div className="row">
          {!user.isPro && <a className="btn secondary" href="/pricing">Upgrade to Pro</a>}
          <a className="btn" href="/onboarding">New project</a>
          <a className="muted" href="/api/auth/logout">Sign out</a>
        </div>
      </div>
      <p className="muted">{user.githubLogin ? `@${user.githubLogin}` : user.email}</p>

      {upgraded && user.isPro && (
        <p className="panel" style={{ borderColor: "var(--good)" }}>You are on Pro now. Fixes and full policies are unlocked on every report.</p>
      )}

      {projects.length === 0 ? (
        <div className="panel">
          <p>No projects yet.</p>
          <a className="btn" href="/onboarding">Scan your first app</a>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {projects.map((p) => {
            const s = latest.get(p.id);
            return (
              <div key={p.id} className="panel row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {p.repoFullName ?? (p.source === "zip" ? "zip upload" : "no repo")} · {p.frameworks.join(", ")}
                  </div>
                </div>
                <div className="row">
                  {s ? (
                    <>
                      <span style={{ color: STATUS_COLOR[s.status] ?? "var(--muted)", fontSize: 13 }}>
                        {s.status} · {s.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                      </span>
                      <a className="btn secondary" href={`/scan/${s.id}`}>Open report</a>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 13 }}>No scan yet</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
