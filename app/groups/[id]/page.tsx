import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { headline } from "@/lib/checklist";
import { FRAMEWORK_LABEL, frameworksOf } from "@/lib/report/format";
import type { ChecklistItem, Framework, Gap } from "@/lib/types";
import { DOC_KIND_LABEL, type ScannedDocument } from "@/lib/scan/documents";
import type { DocConflict } from "@/lib/scan/engine";
import SiteHeader from "../../components/SiteHeader";
import GroupActions from "./GroupActions";
import "../../scan/report.css";
import "./group.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company audit · TriLens" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect(`/signin?next=/groups/${id}`);
  if (!UUID_RE.test(id)) notFound();

  const [group] = await db.select().from(schema.groups).where(and(eq(schema.groups.id, id), eq(schema.groups.userId, user.id))).limit(1);
  if (!group) notFound();

  const projects = await db.select().from(schema.projects).where(eq(schema.projects.groupId, group.id)).orderBy(schema.projects.createdAt);
  const scans = projects.length
    ? await db.select().from(schema.scans).where(inArray(schema.scans.projectId, projects.map((p) => p.id))).orderBy(desc(schema.scans.createdAt))
    : [];
  const latest = new Map<string, (typeof scans)[number]>();
  for (const s of scans) if (!latest.has(s.projectId)) latest.set(s.projectId, s);

  const rows = projects.map((p) => {
    const s = latest.get(p.id);
    const gaps = (Array.isArray(s?.gaps) ? s!.gaps : []) as Gap[];
    const checklist = (Array.isArray(s?.checklist) ? s!.checklist : []) as ChecklistItem[];
    const docs = (s?.documents ?? null) as { list?: ScannedDocument[]; conflicts?: DocConflict[] } | null;
    return { p, s, gaps, checklist, docs };
  });
  const frameworks = frameworksOf(rows.flatMap((r) => r.checklist), (projects[0]?.frameworks ?? []) as Framework[]);
  const running = rows.some((r) => r.s && (r.s.status === "queued" || r.s.status === "running"));
  const done = rows.filter((r) => r.s?.status === "done");
  const allGaps = done.flatMap((r) => r.gaps.map((g) => ({ ...g, repo: r.p.name, scanId: r.s!.id })));
  const sev = (k: Gap["severity"]) => allGaps.filter((g) => g.severity === k).length;
  const conflicts = done.flatMap((r) => (r.docs?.conflicts ?? []).map((c) => ({ ...c, repo: r.p.name })));
  const fwTotals = frameworks.map((f) => {
    const items = done.flatMap((r) => r.checklist.filter((i) => i.framework === f));
    return { f, done: items.filter((i) => i.status === "done").length, total: items.length };
  });

  return (
    <>
      <SiteHeader current="dashboard" />
      <main className="container grp">
        <p className="eyebrow">Company audit · {projects.length} repo{projects.length === 1 ? "" : "s"}</p>
        <div className="grp-head">
          <h1>{group.name}</h1>
          <GroupActions projectIds={projects.map((p) => p.id)} running={running} />
        </div>
        <div className="grp-fw">{frameworks.map((f) => <span key={f} className="rp-pill">{FRAMEWORK_LABEL[f]}</span>)}</div>

        <dl className="grp-stats">
          <div><dt>Reports ready</dt><dd>{done.length}<small> / {projects.length}</small></dd></div>
          <div><dt>High</dt><dd className="bad">{sev("high")}</dd></div>
          <div><dt>Medium</dt><dd className="warn">{sev("medium")}</dd></div>
          <div><dt>Document conflicts</dt><dd>{conflicts.length}</dd></div>
        </dl>

        {fwTotals.length > 0 && done.length > 0 && (
          <div className="grp-fwbars">
            {fwTotals.map(({ f, done: d, total }) => (
              <div key={f}>
                <span>{FRAMEWORK_LABEL[f]}</span>
                <span className="bar"><i style={{ width: `${total ? Math.round((d / total) * 100) : 0}%` }} /></span>
                <span className="mono">{d} / {total} done</span>
              </div>
            ))}
          </div>
        )}

        <h2 className="grp-sec">Repositories</h2>
        <div className="grp-table-wrap">
          <table className="grp-table">
            <thead>
              <tr><th scope="col">App</th><th scope="col">Status</th><th scope="col">Gaps</th>{frameworks.map((f) => <th key={f} scope="col">{f === "SOC2" ? "SOC 2" : f}</th>)}<th scope="col">Documents</th><th scope="col"><span className="sr">Report</span></th></tr>
            </thead>
            <tbody>
              {rows.map(({ p, s, gaps, checklist, docs }) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}<span className="mono sub">{p.repoFullName}</span></th>
                  <td><span className={`st st-${s?.status ?? "none"}`}>{s ? (s.status === "done" ? "Ready" : s.status === "failed" ? "Failed" : "Scanning") : "Not started"}</span>{s?.finishedAt && <span className="sub">{fmt.format(s.finishedAt)}</span>}</td>
                  <td>{s?.status === "done" ? <><b className="bad">{gaps.filter((g) => g.severity === "high").length}</b> high · {gaps.length} total</> : "–"}</td>
                  {frameworks.map((f) => <td key={f} className="mono">{s?.status === "done" ? headline(checklist, f).split(": ")[1].replace(" done", "") : "–"}</td>)}
                  <td>{docs?.list?.length ? `${docs.list.filter((d) => d.read).length} / ${docs.list.length} read${docs.conflicts?.length ? ` · ${docs.conflicts.length} conflict${docs.conflicts.length > 1 ? "s" : ""}` : ""}` : <span className="muted">none added</span>}</td>
                  <td>{s ? <a href={`/scan/${s.id}`}>Open report →</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {conflicts.length > 0 && (
          <>
            <h2 className="grp-sec">Where your documents disagree</h2>
            <ul className="grp-list">
              {conflicts.map((c, i) => (
                <li key={i}><span className={`rp-chip ${c.severity}`}>{c.severity}</span> <strong>{c.title}</strong><span className="sub">{c.repo} · {c.docs.join(" vs ")}: {c.detail}</span></li>
              ))}
            </ul>
          </>
        )}

        {allGaps.length > 0 && (
          <>
            <h2 className="grp-sec">Top issues across all repos</h2>
            <ul className="grp-list">
              {allGaps.filter((g) => g.severity === "high").slice(0, 12).map((g) => (
                <li key={`${g.scanId}-${g.id}`}><span className="rp-chip high">high</span> <a href={`/scan/${g.scanId}#gap-${g.id}`}>{g.title}</a><span className="sub">{g.repo}</span></li>
              ))}
            </ul>
          </>
        )}

        {rows.some((r) => r.docs?.list?.length) && (
          <>
            <h2 className="grp-sec">Documents read</h2>
            <ul className="grp-list">
              {rows.flatMap((r) => (r.docs?.list ?? []).map((d) => (
                <li key={`${r.p.id}-${d.id}`}><strong>{d.title}</strong> <span className="muted">({DOC_KIND_LABEL[d.kind]})</span><span className="sub">{r.p.name} · {d.read ? `${d.promises.length} promise${d.promises.length === 1 ? "" : "s"} found` : "could not be read: check the link is public"}</span></li>
              )))}
            </ul>
          </>
        )}
        <p className="rp-note">SOC 2 results are technical evidence from your code, not a SOC 2 report. Nothing here is legal advice.</p>
      </main>
    </>
  );
}
