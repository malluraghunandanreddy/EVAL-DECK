import "../../report.css";

export default async function ConnectDbPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="rp">
      <a href={`/scan/${id}`} className="muted" style={{ fontSize: 13 }}>← Back to report</a>
      <div className="panel rp-section rp-card-accent">
        <h1 style={{ fontSize: 22 }}>Connect your database (Pro)</h1>
        <p className="muted">
          Coming soon. Paste a read-only connection string and TriLens will check who can read personal data,
          whether row-level security is on, and which columns hold PII. Credentials are encrypted, used once and deleted after the check.
        </p>
        <a className="btn secondary sm" href={`/scan/${id}`}>Back to report</a>
      </div>
    </main>
  );
}
