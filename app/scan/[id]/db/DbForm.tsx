"use client";
import { useState } from "react";

type Result = { tables: number; columns: number; piiColumns: number; rlsOff: string[]; broadRead: string[]; sampledRows: number; findings: number; gaps: number };

export default function DbForm({ scanId, checked, sqliteCommand }: { scanId: string; checked: boolean; sqliteCommand: string }) {
  const [mode, setMode] = useState<"postgres" | "sqlite">("postgres");
  const [url, setUrl] = useState("");
  const [report, setReport] = useState("");
  const [copied, setCopied] = useState(false);
  // SQLite: "auto" logs in over SSH from TriLens; "manual" is the run-a-command-and-paste fallback.
  const [sqliteWay, setSqliteWay] = useState<"auto" | "manual">("auto");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [authType, setAuthType] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [dbPath, setDbPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const ssh = { host, port: Number(port) || 22, username, ...(authType === "password" ? { password } : { privateKey, passphrase: passphrase || undefined }) };
      const payload = mode === "postgres" ? { url } : sqliteWay === "manual" ? { sqliteReport: report } : { ssh, dbPath: candidates ? dbPath || null : null };
      const r = await fetch(`/api/scans/${scanId}/db`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? `HTTP ${r.status}`); return; }
      if (Array.isArray(data.candidates)) {
        // Step 1 of the automatic check: show the SQLite files found on the server.
        setCandidates(data.candidates);
        setDbPath(data.candidates[0] ?? "");
        return;
      }
      setResult(data as Result);
      setUrl("");
      setReport("");
      setPassword("");
      setPrivateKey("");
      setPassphrase("");
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
          {mode === "postgres" ? (
            <>
              <li>Row-level security off on {result.rlsOff.length ? result.rlsOff.join(", ") : "no personal-data tables"}</li>
              <li>Broad read access (anon / public) on {result.broadRead.length ? result.broadRead.join(", ") : "no personal-data tables"}</li>
              <li>{result.sampledRows} rows sampled in memory and discarded</li>
            </>
          ) : (
            <>
              <li>Files readable by others or inside a web folder: {result.broadRead.length ? result.broadRead.join(", ") : "none"}</li>
              <li>No row values were read: the report contains structure and row counts only</li>
            </>
          )}
        </ul>
        <p className="muted" style={{ fontSize: 14 }}>Your report now has {result.gaps} gaps including {result.findings} database findings.</p>
        <a className="btn" href={`/scan/${scanId}`}>Back to the updated report</a>
      </div>
    );
  }

  return (
    <form onSubmit={run} className="panel rp-section" style={{ display: "grid", gap: 10 }}>
      {checked && <p className="notice good" style={{ margin: 0 }}>This report already includes a database check. Running it again replaces those findings.</p>}
      <div className="ob-seg" role="group" aria-label="Database type" style={{ justifySelf: "start" }}>
        <button type="button" aria-pressed={mode === "postgres"} onClick={() => setMode("postgres")}>Postgres / Supabase</button>
        <button type="button" aria-pressed={mode === "sqlite"} onClick={() => setMode("sqlite")}>SQLite on a server (VPS)</button>
      </div>
      {mode === "sqlite" && (
        <div className="ob-seg" role="group" aria-label="How to check SQLite" style={{ justifySelf: "start" }}>
          <button type="button" aria-pressed={sqliteWay === "auto"} onClick={() => { setSqliteWay("auto"); setError(null); }}>Connect to my server</button>
          <button type="button" aria-pressed={sqliteWay === "manual"} onClick={() => { setSqliteWay("manual"); setError(null); }}>Run a command myself</button>
        </div>
      )}
      {mode === "sqlite" && sqliteWay === "auto" ? (
        <>
          <p style={{ margin: 0, fontSize: 14 }}>
            TriLens logs in to your server, finds your SQLite database and reads its <strong>structure only</strong>: tables, columns,
            row counts and file permissions. It opens the database read-only, changes nothing, never reads customer records, and
            forgets your login as soon as the check finishes.
          </p>
          <div className="db-grid">
            <div>
              <label htmlFor="ssh-host">Server IP address</label>
              <input id="ssh-host" value={host} onChange={(e) => { setHost(e.target.value); setCandidates(null); }} placeholder="e.g. 82.25.110.14" autoComplete="off" spellCheck={false} required />
            </div>
            <div>
              <label htmlFor="ssh-port">SSH port</label>
              <input id="ssh-port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </div>
            <div>
              <label htmlFor="ssh-user">Username</label>
              <input id="ssh-user" value={username} onChange={(e) => { setUsername(e.target.value); setCandidates(null); }} autoComplete="off" spellCheck={false} required />
            </div>
          </div>
          <div className="ob-seg" role="group" aria-label="Login method" style={{ justifySelf: "start" }}>
            <button type="button" aria-pressed={authType === "password"} onClick={() => setAuthType("password")}>Password</button>
            <button type="button" aria-pressed={authType === "key"} onClick={() => setAuthType("key")}>SSH key</button>
          </div>
          {authType === "password" ? (
            <div>
              <label htmlFor="ssh-pass">Password</label>
              <input id="ssh-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
            </div>
          ) : (
            <>
              <label htmlFor="ssh-key">Private key</label>
              <textarea id="ssh-key" rows={5} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} spellCheck={false} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} required />
              <label htmlFor="ssh-phrase">Key passphrase (if it has one)</label>
              <input id="ssh-phrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" />
            </>
          )}
          <details style={{ fontSize: 14 }}>
            <summary style={{ cursor: "pointer" }}><strong>Where to find these on Hostinger</strong></summary>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li>Log in to <a href="https://hpanel.hostinger.com" target="_blank" rel="noreferrer">hpanel.hostinger.com</a> and open <strong>VPS</strong>, then your server.</li>
              <li><strong>Overview</strong> shows the IP address and the SSH username (usually <code>root</code>). Port is 22.</li>
              <li>Forgot the password? Use <strong>Settings → Change root password</strong> (or <strong>SSH keys</strong> to add a key).</li>
              <li>Safer: create a login that can only read the app folder and use that instead of <code>root</code>.</li>
            </ol>
          </details>
          {candidates && (
            candidates.length ? (
              <fieldset className="db-pick">
                <legend>Databases found on your server. Pick the one your app uses:</legend>
                {candidates.map((c) => (
                  <label key={c} className="ob-check" style={{ display: "flex", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    <input type="radio" name="dbpath" checked={dbPath === c} onChange={() => setDbPath(c)} /> {c}
                  </label>
                ))}
              </fieldset>
            ) : (
              <div>
                <p className="notice" style={{ margin: "0 0 8px" }}>No SQLite files were found automatically. If you know where it is, type the full path:</p>
                <input value={dbPath} onChange={(e) => setDbPath(e.target.value)} placeholder="/var/www/yourapp/data/app.db" spellCheck={false} style={{ fontFamily: "var(--font-mono)" }} />
              </div>
            )
          )}
          {error && <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
          <button className="btn" type="submit" disabled={busy || !host || !username || (authType === "password" ? !password : !privateKey) || (candidates !== null && !dbPath)}>
            {busy ? (candidates ? "Checking the database…" : "Connecting and searching…") : candidates ? "Check this database" : "Connect and find databases"}
          </button>
        </>
      ) : mode === "sqlite" ? (
        <>
          <p style={{ margin: 0, fontSize: 14 }}>
            SQLite is a file on your server (for example a Hostinger VPS), so TriLens can&apos;t connect to it. Run this on the server
            instead. It opens the database read-only and prints only its structure: tables, columns, row counts, the file&apos;s permissions
            and location, and backup files next to it. <strong>No customer data is read or sent.</strong>
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            <li>Connect to the server: <code>ssh root@your-server-ip</code> (Hostinger: hPanel → VPS → Overview shows the IP and SSH details).</li>
            <li>Find the database file, for example: <code>find / -name &quot;*.db&quot; -o -name &quot;*.sqlite*&quot; 2&gt;/dev/null | grep -v /proc</code></li>
            <li>Copy the command below, change <code>/path/to/your-app.db</code> to that file, paste it into the server and press Enter.</li>
            <li>Copy everything it prints and paste it in the box below.</li>
          </ol>
          <div style={{ position: "relative" }}>
            <pre className="rp-code" style={{ fontSize: 12, maxHeight: 260, overflow: "auto" }}>{sqliteCommand}</pre>
            <button type="button" className="btn secondary sm" style={{ position: "absolute", top: 8, right: 8 }}
              onClick={async () => { try { await navigator.clipboard.writeText(sqliteCommand); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select manually */ } }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <label htmlFor="sqlitereport">What the command printed</label>
          <textarea id="sqlitereport" rows={10} value={report} onChange={(e) => setReport(e.target.value)} spellCheck={false}
            placeholder="-- trilens sqlite v1&#10;-- file 644 524288 /var/www/app/data/app.db&#10;CREATE TABLE users (...);" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} />
          {error && <p style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
          <button className="btn" type="submit" disabled={busy || report.trim().length < 20}>{busy ? "Checking…" : "Check this SQLite database"}</button>
        </>
      ) : (
      <>
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
      </>
      )}
    </form>
  );
}
