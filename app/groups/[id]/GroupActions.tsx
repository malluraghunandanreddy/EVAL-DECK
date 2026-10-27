"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Rescan every repo in the audit, and refresh the page while scans are running. */
export default function GroupActions({ projectIds, running }: { projectIds: string[]; running: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [running, router]);

  async function rescan() {
    setBusy(true);
    await Promise.all(projectIds.map((id) => fetch(`/api/projects/${id}/scans`, { method: "POST" }).catch(() => null)));
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="row">
      {running && <span className="muted" role="status">Scanning… this page updates by itself.</span>}
      <button type="button" className="btn secondary" onClick={rescan} disabled={busy || running}>
        {busy ? "Starting…" : "Scan all again"}
      </button>
      <a className="btn" href="/onboarding">New audit</a>
    </div>
  );
}
