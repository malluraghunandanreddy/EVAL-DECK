import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { count, countDistinct, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { ADMIN_COOKIE as COOKIE, ADMIN_MAX_AGE as MAX_AGE, adminSig, isAdmin } from "@/lib/admin";
import { PLAN_NAME, type PaidPlan } from "@/lib/plans";
import SiteHeader from "../../components/SiteHeader";
import "./proof.css";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const pw = process.env.ADMIN_PASSWORD;
  const given = String(formData.get("password") ?? "");
  if (!pw || !safeEqual(given, pw)) redirect("/admin/proof?error=1");
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  (await cookies()).set(COOKIE, `${exp}.${adminSig(exp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: MAX_AGE,
  });
  redirect("/admin/proof");
}

async function logout() {
  "use server";
  (await cookies()).delete({ name: COOKIE, path: "/admin" });
  redirect("/admin/proof");
}

const istFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

function When({ d }: { d: Date | null }) {
  if (!d) return <span className="muted">-</span>;
  return (
    <span>
      {istFmt.format(d)} IST
      <br />
      <span className="muted" style={{ fontSize: 12 }}>{d.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
    </span>
  );
}

const cell: React.CSSProperties = {};

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="pt">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={head.length} className="muted">No rows yet</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function short(id: string | null) {
  return id ? <code title={id}>{id.slice(0, 8)}</code> : <span className="muted">-</span>;
}

export default async function AdminProof({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await isAdmin())) {
    const { error } = await searchParams;
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <h1>Hackathon proof</h1>
        {!process.env.ADMIN_PASSWORD && <p style={{ color: "var(--bad)" }}>ADMIN_PASSWORD is not set.</p>}
        {error && <p style={{ color: "var(--bad)" }}>Wrong password.</p>}
        <form action={login} className="panel">
          <label htmlFor="pw">Password</label>
          <input id="pw" name="password" type="password" required autoComplete="current-password" />
          <button className="btn" type="submit" style={{ marginTop: 12 }}>Enter</button>
        </form>
      </main>
    );
  }

  const userCount = await db.select({ n: count() }).from(schema.users);
  const projectCount = await db.select({ n: count() }).from(schema.projects);
  const scanCount = await db.select({ n: count() }).from(schema.scans);
  const eventCount = await db.select({ n: count() }).from(schema.events);
  const orderCount = await db.select({ n: count() }).from(schema.orders);
  const eventsByType = await db.select({ type: schema.events.type, n: count() }).from(schema.events).groupBy(schema.events.type);
  const users = await db.select({
        id: schema.users.id, githubLogin: schema.users.githubLogin, email: schema.users.email,
        privateRepoAccess: schema.users.privateRepoAccess, isPro: schema.users.isPro, createdAt: schema.users.createdAt,
      }).from(schema.users).orderBy(desc(schema.users.createdAt)).limit(200);
  const scans = await db.select({
        id: schema.scans.id, projectId: schema.scans.projectId, status: schema.scans.status,
        error: schema.scans.error, createdAt: schema.scans.createdAt, finishedAt: schema.scans.finishedAt,
      }).from(schema.scans).orderBy(desc(schema.scans.createdAt)).limit(200);
  const events = await db.select().from(schema.events).orderBy(desc(schema.events.createdAt)).limit(300);
  const orders = await db.select().from(schema.orders).orderBy(desc(schema.orders.createdAt)).limit(200);
  const onboardedUsers = await db.select({ n: countDistinct(schema.projects.userId) }).from(schema.projects);
  const scannedUsers = await db
        .select({ n: countDistinct(schema.projects.userId) })
        .from(schema.scans)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.scans.projectId))
        .where(eq(schema.scans.status, "done"));
  const interestEvents = await db.select().from(schema.events).where(eq(schema.events.type, "interest")).orderBy(desc(schema.events.createdAt)).limit(500);
  const proUsers = await db.select({ n: count() }).from(schema.users).where(eq(schema.users.isPro, true));
  const interestedUsers = new Set(interestEvents.map((e) => e.userId)).size;
  const funnel: [string, number, string][] = [
    ["Signed in", userCount[0].n, "accounts created"],
    ["Set up an audit", onboardedUsers[0].n, "added a repo"],
    ["Got a report", scannedUsers[0].n, "scan finished"],
    ["Interested in paid", interestedUsers, "clicked I'm interested"],
    ["Paid / unlocked", proUsers[0].n, "Pro accounts"],
  ];
  const top = Math.max(1, ...funnel.map((f) => f[1]));

  const stats: [string, number][] = [
    ["Users", userCount[0].n], ["Projects", projectCount[0].n], ["Scans", scanCount[0].n],
    ["Events", eventCount[0].n], ["Orders", orderCount[0].n],
  ];

  return (
    <>
    <SiteHeader />
    <main className="container" style={{ maxWidth: 1200 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Hackathon proof</h1>
        <div className="row">
          <span className="muted" style={{ fontSize: 13 }}>Generated <When d={new Date()} /></span>
          <form action={logout}><button className="btn secondary" type="submit">Lock</button></form>
        </div>
      </div>

      <ol className="funnel" aria-label="Funnel">
        {funnel.map(([k, v, sub]) => (
          <li key={k}>
            <span className="fv">{v}</span>
            <span className="fk">{k}</span>
            <span className="fs">{sub}</span>
            <span className="fb"><i style={{ width: `${Math.round((v / top) * 100)}%` }} /></span>
          </li>
        ))}
      </ol>

      <div className="row" style={{ marginTop: 16 }}>
        {stats.map(([k, v]) => (
          <div key={k} className="panel" style={{ minWidth: 120 }}>
            <div className="muted" style={{ fontSize: 13 }}>{k}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Events by type:{" "}
        {eventsByType.sort((a, b) => b.n - a.n).map((e) => `${e.type} ${e.n}`).join(" · ") || "none"}
      </p>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 32 }}>
        <h2 style={{ margin: 0 }}>Interested in paid ({interestEvents.length})</h2>
        <a className="btn secondary" href="/admin/interest.csv">Download CSV</a>
      </div>
      <Table
        head={["When", "Email", "GitHub", "Plan"]}
        rows={interestEvents.map((e) => {
          const p = e.payload as { email?: string; login?: string; plan?: PaidPlan };
          return [<When key="t" d={e.createdAt} />, p.email ?? "-", p.login ? <a key="g" href={`https://github.com/${p.login}`}>@{p.login}</a> : "-", p.plan ? PLAN_NAME[p.plan] : "-"];
        })}
      />

      <h2>Users</h2>
      <Table
        head={["Signed up", "GitHub login", "Email", "Private repos", "Pro", "ID"]}
        rows={users.map((u) => [
          <When key="t" d={u.createdAt} />,
          u.githubLogin ? <a href={`https://github.com/${u.githubLogin}`}>@{u.githubLogin}</a> : <span className="muted">email only</span>,
          u.email ?? "-", u.privateRepoAccess ? "yes" : "no", u.isPro ? "PRO" : "free", short(u.id),
        ])}
      />

      <h2>Scans</h2>
      <Table
        head={["Started", "Finished", "Status", "Scan", "Project", "Error"]}
        rows={scans.map((s) => [
          <When key="c" d={s.createdAt} />, <When key="f" d={s.finishedAt} />, s.status,
          <a key="l" href={`/scan/${s.id}`}>{s.id.slice(0, 8)}</a>, short(s.projectId), s.error ?? "",
        ])}
      />

      <h2>Orders</h2>
      <Table
        head={["Created", "Status", "Amount", "Pine Labs order", "Merchant ref", "User"]}
        rows={orders.map((o) => [
          <When key="c" d={o.createdAt} />, o.status, `Rs ${(o.amountPaise / 100).toFixed(2)}`,
          o.pinelabsOrderId ?? "-", o.merchantOrderRef, short(o.userId),
        ])}
      />

      <h2>Events (latest 300)</h2>
      <Table
        head={["At", "Type", "User", "Payload"]}
        rows={events.map((e) => [
          <When key="c" d={e.createdAt} />, <strong key="t">{e.type}</strong>, short(e.userId),
          <code key="p" style={{ fontSize: 12, wordBreak: "break-all" }}>{JSON.stringify(e.payload).slice(0, 300)}</code>,
        ])}
      />
    </main>
    </>
  );
}
