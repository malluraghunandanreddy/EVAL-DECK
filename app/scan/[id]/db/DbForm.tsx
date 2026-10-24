"use client";
import { useState } from "react";

type Result = { tables: number; columns: number; piiColumns: number; rlsOff: string[]; broadRead: string[]; sampledRows: number; findings: number; gaps: number };

export default function DbForm({ scanId, checked }: { scanId: string; checked: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch(`/api/scans/${scanId}/db`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? `HTTP ${r.status}`); return; }
      setResult(data as Result);
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="panel rp-section">
        <h2 style={{ marginTop: 0 }}>Database checked</h2>
        <ul>
          <li>{result.tables} tables, {result.columns} columns, {result.piiColumns} columns that look like personal data</li>
          <li>Row-level security off on {result.rlsOff.length ? result.rlsOff.join(", ") : "no personal-data tables"}</li>
          <li>Broad read access (anon / public) on {result.broadRead.length ? result.broadRead.join(", ") : "no personal-data tables"}</li>
          <li>{result.sampledRows} rows sampled in memory and discarded</li>
        </ul>
        <p className="muted" style={{ fontSize: 14 }}>Your report now has {result.gaps} gaps including {result.findings} database findings.</p>
        <a className="btn" href={`/scan/${scanId}`}>Back to the updated report</a>
      </div>
    );
  }

  return (
    <form onSubmit={run} className="panel rp-section" style={{ display: "grid", gap: 10 }}>
      {checked && <p className="notice good" style={{ margin: 0 }}>This report already includes a database check. Running it again replaces those findings.</p>}
      <label htmlFor="dburl">Postgres connection string</label>
      <input id="dburl" value={url} onChange={(e) => setUrl(e.target.value)} required autoComplete="off" spellCheck={false}
        placeholder="postgresql://postgres.xxxx:password@aws-0-ap-south-1.pooler.supabase.com:6543/postgres" />
      <details open style={{ fontSize: 14 }}>
        <summary style={{ cursor: "pointer" }}><strong>How to get the connection string from Supabase</strong></summary>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>Open your project at <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com/dashboard</a>.</li>
          <li>Click the green <strong>Connect</strong> button at the top of the project page.</li>
          <li>In the dialog pick <strong>Direct → Transaction pooler</strong> (works from serverless, port 6543).</li>
          <li>Copy the URI. It looks like <code>postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres</code>.</li>
          <li>Replace <code>[YOUR-PASSWORD]</code> with your database password. Forgot it? <em>Database → Settings → Reset database password</em>.</li>
          <li>Paste it below. Any other Postgres (Neon, Railway, RDS) works the same way with its own connection string.</li>
        </ol>
        <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          Safer option: create a read-only user first and paste its string instead. In the Supabase SQL editor run
        </p>
        <pre className="rp-code" style={{ fontSize: 12 }}>{`create role trilens_ro login password 'choose-a-password';
grant usage on schema public to trilens_ro;
grant select on all tables in schema public to trilens_ro;`}</pre>
      </details>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        What happens: one read-only transaction lists tables, columns, row-level security and SELECT grants, and reads up to 20 rows of
        personal-data columns in memory to confirm live values. Nothing from your database is stored or sent to an AI, and the string is discarded after the check.
      </p>
      {error && <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
      <button className="btn" type="submit" disabled={busy || !url}>{busy ? "Checking… (up to 30s)" : "Run read-only check"}</button>
    </form>
  );
}
