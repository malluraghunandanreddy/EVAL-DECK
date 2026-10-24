import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { interestedPlans } from "@/lib/interest";
import SiteHeader from "../components/SiteHeader";
import "./dashboard.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your audits · TriLens" };

const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", done: "Ready", failed: "Failed" };

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

async function markAllRead() {
  "use server";
  const user = await getUser();
  if (!user) redirect("/signin?next=/dashboard");
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  redirect("/dashboard");
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ upgraded?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/signin?next=/dashboard");
  const { upgraded } = await searchParams;

  const projects = await db.select().from(schema.projects).where(eq(schema.projects.userId, user.id)).orderBy(desc(schema.projects.createdAt));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const scans = projects.length
    ? await db
        .select({ id: schema.scans.id, projectId: schema.scans.projectId, status: schema.scans.status, createdAt: schema.scans.createdAt })
        .from(schema.scans)
        .where(inArray(schema.scans.projectId, projects.map((p) => p.id)))
        .orderBy(desc(schema.scans.createdAt))
        .limit(100)
    : [];
  const interested = user.isPro ? new Set() : await interestedPlans(user.id);
  const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(10);
  const unread = notes.filter((n) => !n.readAt).length;
  const ready = scans.filter((s) => s.status === "done").length;

  return (
    <>
      <SiteHeader current="dashboard" />
      <main className="container dash">
        <div className="dash-head">
          <div>
            <p className="eyebrow">{user.githubLogin ? `@${user.githubLogin}` : user.email}</p>
            <h1>Your audits</h1>
          </div>
          <div className="row">
            <span className={`plan-chip${user.isPro ? " pro" : ""}`}>{user.isPro ? (user.proUntil ? `Pro until ${new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(user.proUntil)}` : "Pro") : "Free plan"}</span>
            <a className="btn" href="/onboarding">New audit</a>
          </div>
        </div>

        {upgraded && user.isPro && <p className="notice good">You're on Pro. Fixes and full policies are unlocked on every report.</p>}

        <dl className="stats">
          <div><dt>Apps audited</dt><dd>{projects.length}</dd></div>
          <div><dt>Scans run</dt><dd>{scans.length}</dd></div>
          <div><dt>Reports ready</dt><dd>{ready}</dd></div>
        </dl>

        {!user.isPro && (
          <aside className="upsell">
            <div>
              <h2>Want the fix for every gap?</h2>
              <p>Free reports show every gap and its proof. A single report is ₹50, or go Pro monthly for everything.</p>
            </div>
            {interested.size > 0 ? (
              <span className="notice good" style={{ margin: 0 }}>Interest noted. We'll email you.</span>
            ) : (
              <a className="btn" href="/pricing">See paid plans</a>
            )}
          </aside>
        )}

        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="sec">Activity {unread > 0 && <span className="plan-chip pro" style={{ marginLeft: 8 }}>{unread} new</span>}</h2>
          {unread > 0 && <form action={markAllRead}><button className="btn secondary sm" type="submit">Mark all read</button></form>}
        </div>
        {notes.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {user.isPro
              ? "The Drift Watch agent checks your repos every 5 minutes. When a commit changes your privacy gaps, it shows up here" + (user.email ? " and in your inbox." : ".")
              : "On Pro monthly the Drift Watch agent checks your repos every 5 minutes and tells you here when a commit changes your privacy gaps."}
          </p>
        ) : (
          <ul className="notes">
            {notes.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "unread"}>
                <div>
                  <a href={n.href ?? "/dashboard"}><strong>{n.title}</strong></a>
                  {n.body && <p className="muted" style={{ margin: "4px 0 0", whiteSpace: "pre-line", fontSize: 13 }}>{n.body}</p>}
                </div>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmt.format(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}

        <h2 className="sec">History</h2>
        {scans.length === 0 ? (
          <div className="panel empty">
            <p style={{ margin: "0 0 14px" }}>You haven't run an audit yet. Pick a GitHub repo and it takes a couple of minutes.</p>
            <a className="btn" href="/onboarding">Run your first audit</a>
          </div>
        ) : (
          <div className="hist-wrap">
            <table className="hist">
              <thead>
                <tr><th scope="col">App</th><th scope="col">Repo</th><th scope="col">Scanned (IST)</th><th scope="col">Status</th><th scope="col"><span className="sr">Report</span></th></tr>
              </thead>
              <tbody>
                {scans.map((s) => {
                  const p = byId.get(s.projectId);
                  return (
                    <tr key={s.id}>
                      <th scope="row">{p?.name ?? "App"}</th>
                      <td className="mono">{p?.repoFullName ?? (p?.source === "zip" ? "zip upload" : "-")}</td>
                      <td>{fmt.format(s.createdAt)}</td>
                      <td><span className={`st st-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                      <td><a href={`/scan/${s.id}`}>Open report →</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
