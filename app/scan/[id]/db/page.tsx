import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { ownedScan } from "@/lib/agent/access";
import { scanUnlocked } from "@/lib/entitlements";
import DbForm from "./DbForm";
import { SQLITE_REPORT_COMMAND } from "@/lib/scan/sqlitereport";
import "../../../onboarding/onboarding.css";
import "../../report.css";

export const dynamic = "force-dynamic";

export default async function ConnectDbPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/scan/${id}/db`)}`);
  const owned = await ownedScan(id, user);
  if (!owned) redirect("/dashboard");
  if (!scanUnlocked(user, owned.scan)) redirect(`/pay?plan=single&scan=${id}`);
  return (
    <main className="rp">
      <a href={`/scan/${id}`} className="muted" style={{ fontSize: 13 }}>← Back to report</a>
      <h1 style={{ fontSize: 22 }}>Connect your database</h1>
      <p className="muted">
        Connect a Postgres database, or check a SQLite file on your server. TriLens checks who can read personal data, whether row-level security is on,
        and which columns hold PII, then adds the findings to this report with their fixes.
      </p>
      <DbForm scanId={id} checked={!!(owned.scan.coverage as { liveDb?: boolean } | null)?.liveDb} sqliteCommand={SQLITE_REPORT_COMMAND} />
    </main>
  );
}
