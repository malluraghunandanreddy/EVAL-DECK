import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hmacHex, safeEqual } from "@/lib/crypto";
import { approveVersion, rejectVersion } from "@/lib/agent/approve";
import { UUID_RE } from "@/lib/agent/access";

export const dynamic = "force-dynamic";

// Fallback human-approval path for when AgenticOrg is down. Same ADMIN_PASSWORD and admin cookie as /admin/proof.
const COOKIE = "pd_admin";
const MAX_AGE = 60 * 60 * 8;
const PATH = "/admin/approvals";

function adminSig(exp: string): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return hmacHex(`${pw}:${process.env.SESSION_SECRET ?? ""}`, `admin.${exp}`);
}

async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  const expected = exp ? adminSig(exp) : null;
  if (!exp || !sig || !expected || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, expected);
}

async function login(formData: FormData) {
  "use server";
  const pw = process.env.ADMIN_PASSWORD;
  const given = String(formData.get("password") ?? "");
  if (!pw || !safeEqual(given, pw)) redirect(`${PATH}?error=1`);
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  (await cookies()).set(COOKIE, `${exp}.${adminSig(exp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: MAX_AGE,
  });
  redirect(PATH);
}

async function decide(formData: FormData) {
  "use server";
  if (!(await isAdmin())) redirect(PATH);
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;
  if (UUID_RE.test(id)) {
    if (decision === "approve") await approveVersion(id, "admin", note);
    else if (decision === "reject") await rejectVersion(id, "admin", note ?? "Rejected by admin");
  }
  revalidatePath(PATH);
  redirect(PATH);
}

const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

const MODE_LABEL: Record<string, string> = {
  workflow: "AgenticOrg workflow (Path A)",
  agent: "AgenticOrg agent (Path B)",
  manual: "No agent run: admin approval",
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <h1>Policy approvals</h1>
        <form action={login} className="panel">
          <label htmlFor="pw">Admin password</label>
          <input id="pw" name="password" type="password" required autoFocus />
          {sp.error && <p style={{ color: "var(--bad)" }}>Wrong password.</p>}
          <div style={{ marginTop: 12 }}><button className="btn" type="submit">Sign in</button></div>
        </form>
        {!process.env.ADMIN_PASSWORD && <p style={{ color: "var(--bad)" }}>ADMIN_PASSWORD is not set.</p>}
      </main>
    );
  }

  const rows = await db
    .select({
      v: schema.policyVersions,
      siteName: schema.sites.name,
      outOfDate: schema.sites.outOfDate,
      projectName: schema.projects.name,
      repo: schema.projects.repoFullName,
      frameworks: schema.projects.frameworks,
      login: schema.users.githubLogin,
      email: schema.users.email,
    })
    .from(schema.policyVersions)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.policyVersions.siteId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sites.projectId))
    .leftJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(inArray(schema.policyVersions.status, ["pending_review", "approved", "rejected"]))
    .orderBy(desc(schema.policyVersions.createdAt))
    .limit(60);

  const pending = rows.filter((r) => r.v.status === "pending_review");
  const decided = rows.filter((r) => r.v.status !== "pending_review").slice(0, 15);

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Policy approvals</h1>
        <a href="/admin/proof">Proof dashboard</a>
      </div>
      <p className="muted">
        Fallback for when AgenticOrg Approvals is unavailable. Approving publishes the version to the widget and hosted pages and logs an
        <code> approval</code> event with <code>{"{ via: 'admin' }"}</code>. Prefer approving in AgenticOrg when it is up.
      </p>

      <h2>Pending review ({pending.length})</h2>
      {pending.length === 0 && <p className="muted">Nothing waiting.</p>}
      {pending.map(({ v, siteName, projectName, repo, frameworks, login, email, outOfDate }) => (
        <section key={v.id} className="panel" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{projectName}</strong>
            <span className="muted">{fmt.format(v.createdAt)} IST</span>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {login ?? email ?? "unknown user"}{repo ? ` · ${repo}` : ""} · {(frameworks ?? []).join(", ")} · {MODE_LABEL[v.agentMode ?? "manual"] ?? v.agentMode}
            {v.agentRunId ? ` · run ${v.agentRunId}` : ""}{outOfDate ? " · widget out of date" : ""} · site {siteName}
          </div>
          {v.summary && <p>{v.summary}</p>}
          <details>
            <summary>Privacy policy draft</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 420, overflow: "auto" }}>{v.policyMd}</pre>
          </details>
          <details>
            <summary>Terms draft</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 320, overflow: "auto" }}>{v.termsMd}</pre>
          </details>
          <form action={decide} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={v.id} />
            <label htmlFor={`note-${v.id}`}>Reviewer note (optional, shown to the user on reject)</label>
            <textarea id={`note-${v.id}`} name="note" rows={2} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" type="submit" name="decision" value="approve">Approve and publish</button>
              <button className="btn secondary" type="submit" name="decision" value="reject">Reject</button>
            </div>
          </form>
        </section>
      ))}

      <h2>Recently decided</h2>
      {decided.length === 0 && <p className="muted">None yet.</p>}
      <ul>
        {decided.map(({ v, projectName }) => (
          <li key={v.id}>
            <strong>{projectName}</strong>: {v.status}
            {v.approvedAt ? ` ${fmt.format(v.approvedAt)} IST` : ""}
            {v.reviewerNote ? `, note: ${v.reviewerNote}` : ""} · <a href={`/p/${v.siteId}`}>policy</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
