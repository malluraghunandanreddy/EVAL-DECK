"use client";

import { useEffect, useMemo, useState } from "react";
import { frameworksFor, type Framework, type Market } from "@/lib/types";

type Repo = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  description: string | null;
  language: string | null;
};

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
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never pushed";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Onboarding(props: {
  githubLogin: string | null;
  githubConnected: boolean;
  privateRepoAccess: boolean;
}) {
  const [name, setName] = useState("");
  const [markets, setMarkets] = useState<Market[]>(["IN"]);
  const [policyUrl, setPolicyUrl] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Repo | null>(null);
  const [showZip, setShowZip] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const frameworks = useMemo(() => frameworksFor(markets), [markets]);

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
    return (q ? list.filter((r) => r.fullName.toLowerCase().includes(q)) : list).slice(0, 50);
  }, [repos, query]);

  function toggleMarket(m: Market) {
    setMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  function pickRepo(r: Repo) {
    setSelected(r);
    if (!name.trim()) setName(r.fullName.split("/")[1] ?? r.fullName);
  }

  async function findScanId(projectId: string): Promise<string | null> {
    for (let i = 0; i < 10; i++) {
      try {
        const r = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
        const data = await r.json();
        const id = data.projects?.[0]?.latestScan?.id;
        if (id) return id as string;
      } catch {
        /* keep trying */
      }
      await sleep(1000);
    }
    return null;
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError("Give your app a name.");
    if (markets.length === 0) return setError("Pick at least one market.");
    if (!selected) return setError("Pick a repository to scan.");

    setBusy("Creating project…");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          markets,
          policyUrl: policyUrl.trim() || null,
          repoFullName: selected.fullName,
          defaultBranch: selected.defaultBranch,
          source: "github",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not create project (${res.status})`);
      const projectId: string = data.project.id;

      setBusy("Starting scan…");
      // The scan may run inside this request for up to a few minutes; keepalive lets it continue
      // after we navigate away. We only wait briefly for an early scan id.
      const scanReq = fetch(`/api/projects/${projectId}/scans`, { method: "POST", keepalive: true })
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error ?? `Scan failed to start (${r.status})`);
          return (d.scanId ?? d.id ?? d.scan?.id ?? null) as string | null;
        });
      const early = await Promise.race([scanReq, sleep(5000).then(() => null)]);
      const scanId = early ?? (await findScanId(projectId));
      window.location.href = scanId ? `/scan/${scanId}` : "/dashboard";
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Set up your first scan</h1>
        <span className="muted">
          {props.githubLogin ? `Signed in as @${props.githubLogin}` : "Signed in"} · <a href="/dashboard">Dashboard</a>
        </span>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>1. Your app</h2>
        <label htmlFor="name">App name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My AI support bot" maxLength={120} />

        <label>Where are your users?</label>
        <div className="row">
          {MARKET_OPTIONS.map((m) => (
            <label key={m.id} className="row" style={{ margin: 0, gap: 6, color: "var(--text)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={markets.includes(m.id)}
                onChange={() => toggleMarket(m.id)}
                style={{ width: "auto" }}
              />
              {m.label}
            </label>
          ))}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          We will check against:{" "}
          {markets.length === 0 ? (
            <em>pick at least one market</em>
          ) : (
            frameworks.map((f) => (
              <strong key={f} style={{ marginRight: 12, color: "var(--accent)" }}>
                {FRAMEWORK_LABEL[f]}
              </strong>
            ))
          )}
        </p>

        <label htmlFor="policy">Existing privacy policy URL (optional)</label>
        <input
          id="policy"
          type="url"
          value={policyUrl}
          onChange={(e) => setPolicyUrl(e.target.value)}
          placeholder="https://yourapp.com/privacy"
        />
        <p className="muted" style={{ fontSize: 13 }}>No policy yet? Leave it blank and we will draft one from your code.</p>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>2. Pick a repository</h2>
          {props.githubConnected && !props.privateRepoAccess && (
            <a className="btn secondary" href="/api/auth/github?private=1&next=/onboarding">Allow private repos</a>
          )}
        </div>

        {!props.githubConnected ? (
          <p>
            <a className="btn" href="/api/auth/github?next=/onboarding">Connect GitHub</a>{" "}
            <span className="muted">to list your repositories.</span>
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
            <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 8, border: "1px solid var(--line)", borderRadius: 8 }}>
              {filtered.length === 0 && (
                <p className="muted" style={{ padding: 12, margin: 0 }}>
                  No repositories match.{!props.privateRepoAccess && " Private repos appear after you click Allow private repos."}
                </p>
              )}
              {filtered.map((r) => {
                const active = selected?.fullName === r.fullName;
                return (
                  <button
                    key={r.fullName}
                    type="button"
                    onClick={() => pickRepo(r)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: 0,
                      borderBottom: "1px solid var(--line)",
                      background: active ? "rgba(108,140,255,.15)" : "transparent",
                      color: "var(--text)",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <strong>{r.fullName}</strong>
                    {r.private && <span className="muted"> · private</span>}
                    <span className="muted" style={{ float: "right", fontSize: 13 }}>
                      {r.language ? `${r.language} · ` : ""}
                      {timeAgo(r.pushedAt)}
                    </span>
                    {r.description && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        {r.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {selected && (
              <p style={{ marginBottom: 0 }}>
                Selected: <strong>{selected.fullName}</strong> <span className="muted">({selected.defaultBranch})</span>
              </p>
            )}
          </>
        )}

        <p style={{ marginBottom: 0 }}>
          <button type="button" className="btn secondary" onClick={() => setShowZip((v) => !v)}>
            Upload a zip (Replit or Lovable)
          </button>
        </p>
        {showZip && (
          <div className="panel" style={{ marginTop: 8 }}>
            <strong>Zip upload is coming soon.</strong>
            <p className="muted" style={{ marginBottom: 0 }}>
              Tip: In Replit, open the Git pane and connect to GitHub, or download as zip. Lovable projects can be
              synced to GitHub from the project settings, then picked above.
            </p>
          </div>
        )}
      </section>

      {error && (
        <p className="panel" style={{ marginTop: 16, borderColor: "var(--bad)", color: "var(--bad)" }}>
          {error}
        </p>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={submit} disabled={Boolean(busy)}>
          {busy ?? "Scan my app"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          We read your code once to find personal data flows. We never store your source code.
        </span>
      </div>
    </main>
  );
}
