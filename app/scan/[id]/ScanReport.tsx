"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChecklistItem, CodeFinding, DbFinding, Framework, Gap, PolicyClaims, SchemaFinding } from "@/lib/types";
import { headline } from "@/lib/checklist";
import {
  COVERAGE_NOTE,
  FRAMEWORK_LABEL,
  LAYER_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  STATUS_META,
  arr,
  evidenceLocation,
  frameworksOf,
  humanize,
  type PolicyPreview,
  type ScanResponse,
} from "@/lib/report/format";
import { Markdown } from "./Markdown";

const POLL_MS = 3000;
const PROGRESS_STEPS = [
  "Reading your code…",
  "Checking policy…",
  "Comparing with the law…",
  "Building your checklist…",
];

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 2200);
  }, []);
  return { msg, show };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function ScanReport({ scanId }: { scanId: string }) {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
      if (res.status === 401) {
        setLoadError("Please sign in to view this scan.");
        return null;
      }
      if (res.status === 404) {
        setLoadError("Scan not found.");
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ScanResponse;
      setScan(data);
      setLoadError(null);
      return data;
    } catch (e) {
      setLoadError(`Could not load the scan (${(e as Error).message}). Retrying…`);
      return null;
    }
  }, [scanId]);

  const running = !scan || scan.status === "queued" || scan.status === "running";
  const reviewPending = scan?.policyVersion?.status === "pending_review";

  useEffect(() => {
    void load();
  }, [load]);

  // Poll every 3 s while the scan runs or a policy is awaiting review (the poll also advances approval checks).
  useEffect(() => {
    if (!running && !reviewPending) return;
    if (loadError && (loadError.startsWith("Please sign in") || loadError === "Scan not found.")) return;
    const iv = setInterval(() => {
      setTick((n) => n + 1);
      void load();
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [running, reviewPending, load, loadError]);

  if (!scan) {
    return (
      <main className="rp">
        {loadError ? <div className="panel rp-error">{loadError}</div> : <Progress step={0} />}
      </main>
    );
  }

  if (scan.status === "queued" || scan.status === "running") {
    const step = scan.status === "queued" ? 0 : Math.min(1 + Math.floor(tick / 4), PROGRESS_STEPS.length - 1);
    return (
      <main className="rp">
        <Header scan={scan} onShare={null} />
        <Progress step={step} />
      </main>
    );
  }

  if (scan.status === "failed") {
    return (
      <main className="rp">
        <Header scan={scan} onShare={null} />
        <div className="panel rp-error rp-section">
          <h2>The scan failed</h2>
          <p className="muted">{scan.error || "Something went wrong while scanning."}</p>
          <a className="btn secondary sm" href="/dashboard">Back to dashboard</a>
        </div>
      </main>
    );
  }

  const share = async () => {
    const ok = await copyText(`${window.location.origin}/r/${scan.id}`);
    toast.show(ok ? "Share link copied" : "Could not copy link");
  };

  return (
    <main className="rp">
      <Header scan={scan} onShare={share} />
      {loadError && <div className="panel rp-error rp-section">{loadError}</div>}
      <Summary scan={scan} />
      <Checklist scan={scan} />
      <Layers scan={scan} />
      <Gaps scan={scan} />
      <PolicyPanel scan={scan} reload={load} toast={toast.show} />
      <Extras scan={scan} />
      <p className="rp-note">
        PolicyDrift is an automated check of your code, schema and policy text. It is not legal advice.
      </p>
      {toast.msg && <div className="rp-toast" role="status">{toast.msg}</div>}
    </main>
  );
}

/* ---------- header / progress / summary ---------- */

function Header({ scan, onShare }: { scan: ScanResponse; onShare: (() => void) | null }) {
  const p = scan.project;
  const fw = frameworksOf([], p?.frameworks);
  return (
    <div className="rp-header">
      <div>
        <div className="muted" style={{ fontSize: 13 }}>Privacy report</div>
        <h1>{p?.name ?? "Your app"}</h1>
        <div className="rp-meta">
          {p?.repoFullName && <span className="rp-pill">⎇ {p.repoFullName}</span>}
          {fw.map((f) => <span key={f} className="rp-pill">{FRAMEWORK_LABEL[f]}</span>)}
          {scan.finishedAt && <span className="rp-pill">Scanned {new Date(scan.finishedAt).toLocaleString()}</span>}
          {scan.isPro ? <span className="rp-pill pro">★ Pro</span> : <span className="rp-pill">Free plan</span>}
        </div>
      </div>
      {onShare && (
        <div className="rp-actions">
          <button className="btn secondary sm" onClick={onShare}>Share report</button>
          {!scan.isPro && <a className="btn sm" href="/pricing">Upgrade to Pro</a>}
        </div>
      )}
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="panel rp-progress rp-section" aria-live="polite">
      <div className="rp-spinner" />
      <h2 style={{ margin: 0 }}>{PROGRESS_STEPS[step]}</h2>
      <p className="muted" style={{ margin: "6px 0 0" }}>This usually takes under two minutes. Keep this tab open.</p>
      <ul className="rp-steps">
        {PROGRESS_STEPS.map((s, i) => (
          <li key={s} className={i < step ? "ok" : i === step ? "on" : ""}>
            <span className="dot">{i < step ? "✓" : i === step ? "●" : "○"}</span>
            {s.replace("…", "")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ scan }: { scan: ScanResponse }) {
  const items = arr(scan.checklist);
  const gaps = arr(scan.gaps);
  const done = items.filter((i) => i.status === "done").length;
  const todo = items.filter((i) => i.status === "todo").length;
  const high = gaps.filter((g) => g.severity === "high").length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  return (
    <div className="rp-tiles">
      <div className="rp-tile">
        <div className="num">{done}<span className="muted" style={{ fontSize: 16 }}> / {items.length}</span></div>
        <div className="lbl">Checklist items done</div>
        <div className="rp-bar"><span style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="rp-tile">
        <div className="num" style={{ color: todo ? "var(--bad)" : "var(--good)" }}>{todo}</div>
        <div className="lbl">Items to fix</div>
      </div>
      <div className="rp-tile">
        <div className="num" style={{ color: high ? "var(--bad)" : undefined }}>{gaps.length}</div>
        <div className="lbl">Gaps found{high ? ` · ${high} high` : ""}</div>
      </div>
    </div>
  );
}

/* ---------- checklist ---------- */

function Checklist({ scan }: { scan: ScanResponse }) {
  const items = arr(scan.checklist);
  const frameworks = frameworksOf(items, scan.project?.frameworks);
  const [active, setActive] = useState<Framework | null>(null);
  const current = active && frameworks.includes(active) ? active : frameworks[0];
  const gapsById = useMemo(() => new Map(arr(scan.gaps).map((g) => [g.id, g])), [scan.gaps]);

  if (!current) {
    return (
      <section className="rp-section">
        <h2>Compliance checklist</h2>
        <p className="rp-empty">No checklist was produced for this scan.</p>
      </section>
    );
  }
  const mine = items.filter((i) => i.framework === current);
  return (
    <section className="rp-section">
      <h2>Compliance checklist</h2>
      {frameworks.length > 1 && (
        <div className="rp-tabs" role="tablist">
          {frameworks.map((f) => (
            <button key={f} role="tab" aria-selected={f === current} className="rp-tab" onClick={() => setActive(f)}>
              {headline(items, f)}
            </button>
          ))}
        </div>
      )}
      <p className="rp-headline">{headline(items, current)}</p>
      {!scan.coverage?.liveDb && (
        <p className="rp-coverage">
          {COVERAGE_NOTE}
          {arr(scan.dbEnvHints).length > 0 && <> <a href={`/scan/${scan.id}/db`}>Connect database →</a></>}
        </p>
      )}
      <ul className="rp-list">
        {mine.map((item) => (
          <ChecklistRow key={item.id} item={item} gapsById={gapsById} isPro={scan.isPro} />
        ))}
      </ul>
    </section>
  );
}

function ChecklistRow({ item, gapsById, isPro }: { item: ChecklistItem; gapsById: Map<string, Gap>; isPro: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[item.status];
  const linked = arr(item.gapIds).map((id) => gapsById.get(id)).filter((g): g is Gap => !!g);
  const topSev = SEVERITIES.find((s) => linked.some((g) => g.severity === s));
  return (
    <li className={`rp-item ${item.status}`}>
      <div className="rp-item-row">
        <span className={`rp-status ${item.status}`} title={meta.label} aria-label={meta.label}>{meta.icon}</span>
        <div className="rp-item-body">
          <div className="rp-item-title">{item.title}</div>
          <div className="rp-item-sub">
            <span className="rp-law">{item.lawRef}</span>
            <span>{meta.label}</span>
            {topSev && <span className={`rp-chip ${topSev}`}>{SEVERITY_LABEL[topSev]}</span>}
          </div>
          {linked.length > 0 && (
            <ul className="rp-gaplinks">
              {linked.map((g) => (
                <li key={g.id}>↳ <a href={`#gap-${g.id}`}>{g.title}</a></li>
              ))}
            </ul>
          )}
          {item.status === "todo" &&
            (isPro && item.fix ? (
              <>
                <button className="rp-fix-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                  {open ? "▾ Hide fix" : "▸ How to fix"}
                </button>
                {open && <div className="rp-fix">{item.fix}</div>}
              </>
            ) : !isPro ? (
              <LockedFix />
            ) : null)}
        </div>
      </div>
    </li>
  );
}

function LockedFix() {
  return (
    <a className="rp-lock" href="/pricing">
      <span>🔒 How to fix (Pro)</span>
      <span>Unlock →</span>
    </a>
  );
}

/* ---------- layer cards ---------- */

function Tags({ values }: { values: string[] }) {
  if (!values.length) return <span className="muted">None stated</span>;
  return <div className="rp-tags">{values.map((v) => <span key={v} className="rp-tag">{humanize(v)}</span>)}</div>;
}

const MAX_ROWS = 5;

function Layers({ scan }: { scan: ScanResponse }) {
  const claims = scan.policyClaims;
  const code = arr(scan.codeFindings);
  const schemaF = arr(scan.schemaFindings);
  const dbF = arr(scan.dbFindings);
  return (
    <section className="rp-section">
      <h2>Three layers compared</h2>
      <div className="rp-layers">
        <PolicyLayer claims={claims} />
        <CodeLayer findings={code} />
        <StorageLayer schemaFindings={schemaF} dbFindings={dbF} liveDb={!!scan.coverage?.liveDb} />
      </div>
    </section>
  );
}

function PolicyLayer({ claims }: { claims: PolicyClaims | null }) {
  return (
    <div className="rp-layer">
      <h3><span className="ico">📄</span>Policy says</h3>
      {!claims ? (
        <p className="rp-empty">No policy data.</p>
      ) : claims.noPolicy ? (
        <p style={{ color: "var(--bad)", fontSize: 14 }}>No privacy policy found. Users are told nothing about what you collect.</p>
      ) : (
        <dl className="rp-kv">
          <dt>Collects</dt><dd><Tags values={arr(claims.collected)} /></dd>
          <dt>Purposes</dt><dd><Tags values={arr(claims.purposes)} /></dd>
          <dt>Third parties</dt><dd><Tags values={arr(claims.thirdParties)} /></dd>
          <dt>Retention</dt><dd>{claims.retention || <span className="muted">Not stated</span>}</dd>
          <dt>Cross-border</dt><dd>{claims.crossBorder || <span className="muted">Not stated</span>}</dd>
        </dl>
      )}
    </div>
  );
}

function CodeLayer({ findings }: { findings: CodeFinding[] }) {
  const vendors = [...new Set(findings.map((f) => f.vendor).filter((v): v is string => !!v))];
  const types = [...new Set(findings.flatMap((f) => arr(f.dataTypes)))];
  return (
    <div className="rp-layer">
      <h3><span className="ico">⌨</span>Code does</h3>
      {findings.length === 0 ? (
        <p className="rp-empty">No personal-data handling found in code.</p>
      ) : (
        <>
          <dl className="rp-kv">
            <dt>Sends data to</dt><dd><Tags values={vendors} /></dd>
            <dt>Handles</dt><dd><Tags values={types} /></dd>
          </dl>
          <ul className="rp-findings">
            {findings.slice(0, MAX_ROWS).map((f, i) => (
              <li key={i}>
                <div>{f.summary || `${humanize(f.kind)}${f.vendor ? `: ${f.vendor}` : ""}${f.dataTypes?.length ? ` (${f.dataTypes.join(", ")})` : ""}`}</div>
                <div className="loc">{f.file}:{f.line}</div>
              </li>
            ))}
          </ul>
          {findings.length > MAX_ROWS && <div className="rp-more">+ {findings.length - MAX_ROWS} more findings</div>}
        </>
      )}
    </div>
  );
}

function StorageLayer({ schemaFindings, dbFindings, liveDb }: { schemaFindings: SchemaFinding[]; dbFindings: DbFinding[]; liveDb: boolean }) {
  const rows: { key: string; text: string; loc: string }[] = [
    ...dbFindings.map((f, i) => ({
      key: `d${i}`,
      text: f.detail || `${humanize(f.kind)} on ${f.table}${f.column ? `.${f.column}` : ""}`,
      loc: `live DB · ${f.table}${f.column ? `.${f.column}` : ""}${f.roles?.length ? ` · ${f.roles.join(", ")}` : ""}`,
    })),
    ...schemaFindings.map((f, i) => ({
      key: `s${i}`,
      text: `${f.table}${f.column ? `.${f.column}` : ""}: ${humanize(f.kind)}${f.dataTypes?.length ? ` (${f.dataTypes.join(", ")})` : ""}`,
      loc: `${f.file}:${f.line}`,
    })),
  ];
  const tables = [...new Set([...schemaFindings.map((f) => f.table), ...dbFindings.map((f) => f.table)])];
  return (
    <div className="rp-layer">
      <h3><span className="ico">🗄</span>Database stores</h3>
      <div className="muted" style={{ fontSize: 12 }}>{liveDb ? "From schema files and your live database" : "From schema and migration files"}</div>
      {rows.length === 0 ? (
        <p className="rp-empty">No personal-data tables found.</p>
      ) : (
        <>
          <dl className="rp-kv"><dt>Tables with personal data</dt><dd><Tags values={tables} /></dd></dl>
          <ul className="rp-findings">
            {rows.slice(0, MAX_ROWS).map((r) => (
              <li key={r.key}><div>{r.text}</div><div className="loc">{r.loc}</div></li>
            ))}
          </ul>
          {rows.length > MAX_ROWS && <div className="rp-more">+ {rows.length - MAX_ROWS} more findings</div>}
        </>
      )}
    </div>
  );
}

/* ---------- gaps ---------- */

function Gaps({ scan }: { scan: ScanResponse }) {
  const gaps = arr(scan.gaps);
  return (
    <section className="rp-section">
      <div className="rp-section-head">
        <h2>Gaps found</h2>
        <span className="muted" style={{ fontSize: 13 }}>{gaps.length} total</span>
      </div>
      {gaps.length === 0 && <div className="panel rp-empty">No gaps found between your policy, code and storage. 🎉</div>}
      {SEVERITIES.map((sev) => {
        const group = gaps.filter((g) => g.severity === sev);
        if (!group.length) return null;
        return (
          <div key={sev} className="rp-sev-group">
            <h3><span className={`rp-chip ${sev}`}>{SEVERITY_LABEL[sev]}</span> {group.length} {group.length === 1 ? "gap" : "gaps"}</h3>
            {group.map((g) => <GapCard key={g.id} gap={g} isPro={scan.isPro} />)}
          </div>
        );
      })}
    </section>
  );
}

function GapCard({ gap, isPro }: { gap: Gap; isPro: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <article id={`gap-${gap.id}`} className="rp-gap">
      <div className="row" style={{ gap: 6 }}>
        <span className={`rp-chip ${gap.severity}`}>{SEVERITY_LABEL[gap.severity]}</span>
        <span className="rp-chip neutral">{LAYER_LABEL[gap.layer] ?? humanize(gap.layer)}</span>
        {arr(gap.frameworks).map((f) => <span key={f} className="rp-chip neutral">{f}</span>)}
      </div>
      <p className="rp-gap-title">{gap.title}</p>
      {arr(gap.evidence).map((e, i) => {
        const loc = evidenceLocation(e);
        return (
          <div key={i} className="rp-ev">
            {loc && <div className="loc">{loc}</div>}
            {e.snippet && <pre className="rp-code">{e.snippet}</pre>}
          </div>
        );
      })}
      {arr(gap.law).length > 0 && (
        <div className="rp-laws">
          {gap.law.map((l, i) => (
            <div key={i}><span className="rp-law">{l.regime} {l.ref}</span> <span className="txt">{l.text}</span></div>
          ))}
        </div>
      )}
      {isPro && gap.fix ? (
        <>
          <button className="rp-fix-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "▾ Hide fix" : "▸ How to fix"}
          </button>
          {open && <div className="rp-fix">{gap.fix}</div>}
        </>
      ) : !isPro ? (
        <LockedFix />
      ) : null}
    </article>
  );
}

/* ---------- policy preview + publish ---------- */

function PolicyPanel({ scan, reload, toast }: { scan: ScanResponse; reload: () => Promise<unknown>; toast: (m: string) => void }) {
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scans/${scan.id}/policy-preview`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as PolicyPreview;
      })
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setErr((e as Error).message));
    return () => { cancelled = true; };
  }, [scan.id, scan.isPro]);

  const sections = arr(preview?.sections);
  const visible = scan.isPro && !preview?.locked ? sections : sections.slice(0, 2);
  const hiddenCount = Math.max(0, (preview?.totalSections ?? sections.length) - visible.length);
  const fullMd = sections.map((s) => `## ${s.title}\n\n${s.md}`).join("\n\n") + "\n\n---\n_Not legal advice._\n";
  const fileBase = (scan.project?.name ?? "privacy-policy").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const download = () => {
    const blob = new Blob([fullMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase}-privacy-policy.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const r = await fetch(`/api/scans/${scan.id}/fix`, { method: "POST" });
      if (r.status === 402 || r.status === 403) { window.location.href = "/pricing"; return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast("Sent for human review");
      await reload();
    } catch (e) {
      toast(`Could not request publish (${(e as Error).message})`);
    } finally {
      setPublishing(false);
    }
  };

  const unlocked = scan.isPro && !preview?.locked;

  return (
    <section className="rp-section">
      <div className="rp-section-head">
        <h2>Your privacy policy and terms</h2>
        {unlocked && sections.length > 0 && (
          <div className="rp-actions">
            <button className="btn secondary sm" onClick={async () => toast((await copyText(fullMd)) ? "Policy copied" : "Could not copy")}>Copy</button>
            <button className="btn secondary sm" onClick={download}>Download .md</button>
          </div>
        )}
      </div>
      <div className="panel rp-policy">
        {err && <p className="rp-empty">Policy preview is not available yet ({err}).</p>}
        {!err && !preview && <p className="rp-empty">Drafting a policy that matches your code…</p>}
        {visible.map((s, i) => (
          <div key={i} className="rp-psec">
            <h3>{s.title}</h3>
            <Markdown md={s.md} />
          </div>
        ))}
        {!unlocked && preview && hiddenCount > 0 && (
          <div className="rp-blurred">
            {Array.from({ length: Math.min(hiddenCount, 3) }).map((_, i) => (
              <div key={i} className="rp-psec">
                <h3>Section {visible.length + i + 1}</h3>
                <div className="rp-fake-line" style={{ width: "92%" }} />
                <div className="rp-fake-line" style={{ width: "78%" }} />
                <div className="rp-fake-line" style={{ width: "85%" }} />
              </div>
            ))}
            <div className="rp-unlock">
              <strong>{hiddenCount} more {hiddenCount === 1 ? "section" : "sections"}</strong>
              <span className="muted" style={{ fontSize: 13 }}>Full policy and terms, copy, download and one-click publish.</span>
              <a className="btn" href="/pricing">🔒 Unlock with Pro</a>
            </div>
          </div>
        )}
        {scan.isPro && <PublishBox scan={scan} publishing={publishing} onPublish={publish} toast={toast} />}
      </div>
    </section>
  );
}

function PublishBox({ scan, publishing, onPublish, toast }: { scan: ScanResponse; publishing: boolean; onPublish: () => void; toast: (m: string) => void }) {
  const pv = scan.policyVersion ?? null;
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  if (pv?.status === "approved" && pv.siteId) {
    const snippet = `<script src="${origin}/w/${pv.siteId}.js" async></script>`;
    return (
      <div className="rp-publish">
        <div className="rp-state approved">✓ Approved and published</div>
        {pv.reviewerNote && <p className="muted" style={{ fontSize: 13 }}>Reviewer: {pv.reviewerNote}</p>}
        <p style={{ fontSize: 14, margin: "10px 0 4px" }}>Add this to your site to show the policy widget:</p>
        <pre className="rp-code">{snippet}</pre>
        <div className="rp-actions" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={async () => toast((await copyText(snippet)) ? "Snippet copied" : "Could not copy")}>Copy snippet</button>
          <a className="btn secondary sm" href={`/p/${pv.siteId}`} target="_blank" rel="noreferrer">Privacy page ↗</a>
          <a className="btn secondary sm" href={`/t/${pv.siteId}`} target="_blank" rel="noreferrer">Terms page ↗</a>
        </div>
      </div>
    );
  }
  if (pv?.status === "pending_review") {
    return (
      <div className="rp-publish">
        <div className="rp-state pending">⏳ Awaiting human review</div>
        <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>A reviewer checks the draft before it goes live. This page updates automatically.</p>
      </div>
    );
  }
  return (
    <div className="rp-publish">
      {pv?.status === "rejected" && (
        <>
          <div className="rp-state rejected">✕ Rejected</div>
          {pv.reviewerNote && <p className="muted" style={{ fontSize: 13 }}>Reviewer: {pv.reviewerNote}</p>}
        </>
      )}
      <div className="row" style={{ justifyContent: "space-between", marginTop: pv ? 8 : 0 }}>
        <span style={{ fontSize: 14 }}>Publish a hosted policy and terms page, reviewed by a human before it goes live.</span>
        <button className="btn" disabled={publishing} onClick={onPublish}>
          {publishing ? "Sending…" : pv?.status === "rejected" ? "Request again" : "Publish my policy"}
        </button>
      </div>
    </div>
  );
}

/* ---------- extras ---------- */

function Extras({ scan }: { scan: ScanResponse }) {
  const hints = arr(scan.dbEnvHints);
  return (
    <section className="rp-section rp-cards">
      {hints.length > 0 && !scan.coverage?.liveDb && (
        <div className="panel rp-card-accent">
          <h3>🗄 Connect your database (Pro)</h3>
          <p className="muted" style={{ fontSize: 14 }}>
            We found database settings in your repo ({hints.slice(0, 3).join(", ")}{hints.length > 3 ? "…" : ""}). A read-only check shows who can read personal data, whether row-level security is on, and PII hidden in columns.
          </p>
          <a className="btn sm" href={scan.isPro ? `/scan/${scan.id}/db` : "/pricing"}>{scan.isPro ? "Connect database" : "Unlock with Pro"}</a>
        </div>
      )}
      <div className="panel rp-soon">
        <h3>🛡 Coming soon: agent red-teaming</h3>
        <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
          We will probe your AI features with adversarial prompts to see whether they leak personal data they should not.
        </p>
      </div>
    </section>
  );
}
