"use client";

import { useEffect, useMemo, useState } from "react";
import { frameworksFor, type Framework, type Market } from "@/lib/types";
import "./onboarding.css";

type Repo = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  description: string | null;
  language: string | null;
};

type DocKind = "privacy" | "terms" | "engagement" | "nda" | "dpa" | "other";
type Doc = { key: number; kind: DocKind; title: string; mode: "url" | "text"; url: string; text: string };
type Pick = { repo: Repo; name: string; docs: Doc[] };

const MARKET_OPTIONS: { id: Market; label: string }[] = [
  { id: "IN", label: "India" },
  { id: "EU", label: "European Union" },
  { id: "UK", label: "United Kingdom" },
  { id: "US", label: "United States" },
  { id: "OTHER", label: "Other / global" },
];

const FRAMEWORK_LABEL: Record<Framework, string> = {
  DPDP: "DPDP Act 2023 (India)",
  GDPR: "GDPR (EU / UK)",
  CCPA: "CCPA (California, US)",
  SOC2: "SOC 2 (Trust Services Criteria)",
};

const DOC_KINDS: { id: DocKind; label: string }[] = [
  { id: "privacy", label: "Privacy policy" },
  { id: "terms", label: "Terms and conditions" },
  { id: "engagement", label: "Engagement terms" },
  { id: "nda", label: "NDA" },
  { id: "dpa", label: "Data processing agreement" },
  { id: "other", label: "Other document" },
];
const KIND_LABEL = Object.fromEntries(DOC_KINDS.map((k) => [k.id, k.label])) as Record<DocKind, string>;

function timeAgo(iso: string | null): string {
  if (!iso) return "never pushed";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

let nextKey = 1;
const newDoc = (kind: DocKind): Doc => ({ key: nextKey++, kind, title: "", mode: "url", url: "", text: "" });

/** Editable list of legal documents (link or pasted text). */
function DocList({ docs, onChange, emptyHint }: { docs: Doc[]; onChange: (d: Doc[]) => void; emptyHint: string }) {
  const [adding, setAdding] = useState<DocKind>("privacy");
  const update = (key: number, patch: Partial<Doc>) => onChange(docs.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  return (
    <div className="ob-docs">
      {docs.length === 0 && <p className="muted ob-hint">{emptyHint}</p>}
      {docs.map((d) => (
        <div key={d.key} className="ob-doc">
          <div className="ob-doc-head">
            <strong>{KIND_LABEL[d.kind]}</strong>
            <div className="ob-seg" role="group" aria-label="How to add this document">
              <button type="button" aria-pressed={d.mode === "url"} onClick={() => update(d.key, { mode: "url" })}>Link</button>
              <button type="button" aria-pressed={d.mode === "text"} onClick={() => update(d.key, { mode: "text" })}>Paste text</button>
            </div>
            <button type="button" className="ob-remove" onClick={() => onChange(docs.filter((x) => x.key !== d.key))} aria-label={`Remove ${KIND_LABEL[d.kind]}`}>Remove</button>
          </div>
          {d.mode === "url" ? (
            <input type="url" value={d.url} onChange={(e) => update(d.key, { url: e.target.value })} placeholder="https://yourcompany.com/privacy" aria-label={`${KIND_LABEL[d.kind]} link`} />
          ) : (
            <textarea rows={5} value={d.text} onChange={(e) => update(d.key, { text: e.target.value })} placeholder="Paste the document text. Use this for documents that aren't public, like an NDA." aria-label={`${KIND_LABEL[d.kind]} text`} />
          )}
        </div>
      ))}
      <div className="row ob-add">
        <select value={adding} onChange={(e) => setAdding(e.target.value as DocKind)} aria-label="Document type">
          {DOC_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <button type="button" className="btn secondary" onClick={() => onChange([...docs, newDoc(adding)])}>Add document</button>
      </div>
    </div>
  );
}

export default function Onboarding(props: {
  githubLogin: string | null;
  githubConnected: boolean;
  privateRepoAccess: boolean;
  maxRepos: number;
  githubClientId: string | null;
}) {
  const [auditName, setAuditName] = useState("");
  const [markets, setMarkets] = useState<Market[]>(["IN"]);
  const [soc2, setSoc2] = useState(false);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Pick[]>([]);
  const [shared, setShared] = useState<Doc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameworks = useMemo(() => frameworksFor(markets, { soc2 }), [markets, soc2]);

  useEffect(() => {
    if (!props.githubConnected) return;
    fetch("/api/github/repos")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
        setRepos(data.repos as Repo[]);
      })
      .catch((e: Error) => setRepoError(e.message));
  }, [props.githubConnected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = repos ?? [];
    return (q ? list.filter((r) => r.fullName.toLowerCase().includes(q)) : list).slice(0, 100);
  }, [repos, query]);

  const isPicked = (r: Repo) => picked.some((p) => p.repo.fullName === r.fullName);
  function toggleRepo(r: Repo) {
    setError(null);
    if (isPicked(r)) return setPicked((cur) => cur.filter((p) => p.repo.fullName !== r.fullName));
    if (picked.length >= props.maxRepos) {
      return setError(`You can scan up to ${props.maxRepos} repos at a time on your plan.`);
    }
    setPicked((cur) => [...cur, { repo: r, name: r.fullName.split("/")[1] ?? r.fullName, docs: [] }]);
    if (!auditName.trim()) setAuditName(r.fullName.split("/")[0]);
  }
  const updatePick = (fullName: string, patch: Partial<Pick>) =>
    setPicked((cur) => cur.map((p) => (p.repo.fullName === fullName ? { ...p, ...patch } : p)));

  function toggleMarket(m: Market) {
    setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  const docPayload = (docs: Doc[]) =>
    docs
      .filter((d) => (d.mode === "url" ? d.url.trim() : d.text.trim()))
      .map((d) => ({ kind: d.kind, title: d.title || undefined, url: d.mode === "url" ? d.url.trim() : null, text: d.mode === "text" ? d.text : null }));

  async function submit() {
    setError(null);
    if (markets.length === 0) return setError("Pick at least one market.");
    if (picked.length === 0) return setError("Pick at least one repository to scan.");
    const name = auditName.trim() || picked[0].repo.fullName.split("/")[0];

    setBusy("Creating your audit…");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          markets,
          soc2,
          sharedDocuments: docPayload(shared),
          repos: picked.map((p) => ({ fullName: p.repo.fullName, defaultBranch: p.repo.defaultBranch, name: p.name.trim() || undefined, documents: docPayload(p.docs) })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not create the audit (${res.status})`);
      const projects = data.projects as { id: string }[];

      setBusy(`Starting ${projects.length} scan${projects.length > 1 ? "s" : ""}…`);
      // Each scan runs in its own server invocation; the start call returns as soon as it is queued.
      const started = await Promise.all(
        projects.map((p) =>
          fetch(`/api/projects/${p.id}/scans`, { method: "POST", keepalive: true })
            .then((r) => r.json().catch(() => ({})))
            .then((d) => (d.scanId as string | undefined) ?? null)
            .catch(() => null),
        ),
      );
      window.location.href = projects.length === 1 && started[0] ? `/scan/${started[0]}` : `/groups/${data.groupId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const orgLink = props.githubClientId ? `https://github.com/settings/connections/applications/${props.githubClientId}` : "https://github.com/settings/applications";

  return (
    <main className="container ob">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>New audit</h1>
        <span className="muted">
          {props.githubLogin ? `Signed in as @${props.githubLogin}` : "Signed in"} · <a href="/dashboard">Dashboard</a>
        </span>
      </div>

      <section className="panel ob-sec">
        <h2>1. What to check against</h2>
        <label htmlFor="audit-name">Audit name</label>
        <input id="audit-name" value={auditName} onChange={(e) => setAuditName(e.target.value)} placeholder="Company or product name" maxLength={120} />

        <label>Where are your users?</label>
        <div className="row">
          {MARKET_OPTIONS.map((m) => (
            <label key={m.id} className="ob-check">
              <input type="checkbox" checked={markets.includes(m.id)} onChange={() => toggleMarket(m.id)} />
              {m.label}
            </label>
          ))}
        </div>
        <label className="ob-check ob-soc2">
          <input type="checkbox" checked={soc2} onChange={(e) => setSoc2(e.target.checked)} />
          Also check SOC 2 controls
          <span className="muted">Access, secrets, logging, vendors, retention and change control, from your code. Not a SOC 2 audit.</span>
        </label>
        <p className="muted" style={{ marginBottom: 0 }}>
          We will check against:{" "}
          {markets.length === 0 ? <em>pick at least one market</em> : frameworks.map((f) => <strong key={f} className="ob-fw">{FRAMEWORK_LABEL[f]}</strong>)}
        </p>
      </section>

      <section className="panel ob-sec">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>2. Pick repositories</h2>
          <span className="muted">{picked.length} of {props.maxRepos} picked</span>
        </div>
        {props.githubConnected && !props.privateRepoAccess && (
          <p style={{ marginBottom: 0 }}>
            <a className="btn secondary" href="/api/auth/github?private=1&next=/onboarding">Allow private repos</a>
          </p>
        )}

        {!props.githubConnected ? (
          <p>
            <a className="btn" href="/api/auth/github?next=/onboarding">Connect GitHub</a> <span className="muted">to list your repositories.</span>
          </p>
        ) : repoError ? (
          <p style={{ color: "var(--bad)" }}>
            {repoError} <a href="/api/auth/github?next=/onboarding">Sign in with GitHub again</a>
          </p>
        ) : repos === null ? (
          <p className="muted">Loading your repositories…</p>
        ) : (
          <>
            <label htmlFor="q">Search</label>
            <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name" />
            <div className="ob-repos">
              {filtered.length === 0 && (
                <div className="ob-empty">
                  <p style={{ margin: 0 }}>{repos.length === 0 ? "No repositories found for this GitHub account." : "No repositories match."}</p>
                  {repos.length === 0 && (
                    <p className="muted" style={{ margin: "6px 0 0" }}>
                      Repos owned by an organization only appear after the organization approves TriLens.{" "}
                      <a href={orgLink} target="_blank" rel="noreferrer">Grant organization access on GitHub</a>, then reload this page.
                      {!props.privateRepoAccess && " Private repos also need Allow private repos above."}
                    </p>
                  )}
                </div>
              )}
              {filtered.map((r) => {
                const on = isPicked(r);
                return (
                  <label key={r.fullName} className={`ob-repo${on ? " on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleRepo(r)} />
                    <span className="ob-repo-main">
                      <strong>{r.fullName}</strong>
                      {r.private && <span className="muted"> · private</span>}
                      {r.description && <span className="muted ob-repo-desc">{r.description}</span>}
                    </span>
                    <span className="muted ob-repo-meta">{r.language ? `${r.language} · ` : ""}{timeAgo(r.pushedAt)}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="panel ob-sec">
        <h2>3. Legal documents</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Add the privacy policy, terms, engagement terms, NDA or DPA that cover each repo. Each document is checked against the code,
          and documents are checked against each other. Leave a repo empty and we look for a privacy file in the repo, or draft one.
        </p>

        <h3 className="ob-h3">Shared by every repo</h3>
        <DocList docs={shared} onChange={setShared} emptyHint="For example, the company privacy policy that covers all your products." />

        {picked.map((p) => (
          <div key={p.repo.fullName} className="ob-pick">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 className="ob-h3" style={{ margin: 0 }}>{p.repo.fullName}</h3>
              <input className="ob-name" value={p.name} onChange={(e) => updatePick(p.repo.fullName, { name: e.target.value })} aria-label={`Display name for ${p.repo.fullName}`} maxLength={120} />
            </div>
            <DocList docs={p.docs} onChange={(docs) => updatePick(p.repo.fullName, { docs })} emptyHint="Only the shared documents apply to this repo." />
          </div>
        ))}
        {picked.length === 0 && <p className="muted">Pick repositories above to add documents for each one.</p>}
      </section>

      {error && <p className="notice bad" style={{ marginTop: 16 }}>{error}</p>}

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={submit} disabled={Boolean(busy)}>
          {busy ?? (picked.length > 1 ? `Scan ${picked.length} repos` : "Scan my app")}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          We read your code once to find personal data flows. We never store your source code.
        </span>
      </div>
    </main>
  );
}
