import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { UUID_RE } from "../agent/access";
import { latestApproved } from "../agent/review";
import { markdownToHtml } from "./markdown";

const CSS = `
.pd-doc{max-width:760px;margin:0 auto;padding:32px 16px 8px}
.pd-doc .meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;color:var(--muted);font-size:13px;margin-bottom:16px}
.pd-doc .badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
.pd-doc .badge.warn{color:var(--warn);border-color:var(--warn)}
.pd-doc .badge.ok{color:var(--good);border-color:var(--good)}
.pd-doc article h1{font-size:28px;line-height:1.2;margin:0 0 8px}
.pd-doc article h2{font-size:20px;margin:28px 0 8px;padding-top:8px;border-top:1px solid var(--line)}
.pd-doc article h3{font-size:16px;margin:20px 0 6px}
.pd-doc article p,.pd-doc article li{color:var(--text)}
.pd-doc article ul,.pd-doc article ol{padding-left:22px}
.pd-doc article table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;display:block;overflow-x:auto}
.pd-doc article th,.pd-doc article td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.pd-doc article code{background:var(--panel);padding:1px 5px;border-radius:4px;font-size:13px}
.pd-doc article pre{background:var(--panel);padding:12px;border-radius:8px;overflow-x:auto}
.pd-doc article blockquote{margin:12px 0;padding:4px 12px;border-left:3px solid var(--line);color:var(--muted)}
.pd-doc .foot{margin-top:32px;color:var(--muted);font-size:13px}
`;

export async function loadHosted(siteIdRaw: string) {
  const siteId = siteIdRaw.replace(/\.(md|html)$/i, "");
  if (!UUID_RE.test(siteId)) return null;
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  if (!site) return null;
  const version = await latestApproved(site.id);
  return { site, version };
}

export function HostedDoc(props: {
  kind: "policy" | "terms";
  siteId: string;
  siteName: string;
  md: string | null;
  approvedAt: Date | null;
  outOfDate: boolean;
}) {
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "") || "/";
  const other = props.kind === "policy" ? { href: `/t/${props.siteId}`, label: "Terms of Service" } : { href: `/p/${props.siteId}`, label: "Privacy Policy" };
  return (
    <main className="pd-doc">
      <style>{CSS}</style>
      <div className="meta">
        <span>{props.siteName}</span>
        {props.approvedAt && <span className="badge ok">Last verified {props.approvedAt.toISOString().slice(0, 10)}</span>}
        {props.outOfDate && <span className="badge warn">Out of date, review pending</span>}
        <a href={other.href}>{other.label}</a>
      </div>
      {props.md ? (
        <article dangerouslySetInnerHTML={{ __html: markdownToHtml(props.md) }} />
      ) : (
        <article>
          <h1>{props.kind === "policy" ? "Privacy Policy" : "Terms of Service"}</h1>
          <p className="muted">No approved version yet. This page shows the document once a human reviewer approves it.</p>
        </article>
      )}
      <p className="foot">
        Generated and monitored by <a href={base}>PolicyDrift</a> from automated scans of this app&apos;s code and storage, then approved by a human reviewer. Not legal advice.
      </p>
    </main>
  );
}
