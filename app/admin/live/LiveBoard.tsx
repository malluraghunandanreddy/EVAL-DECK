"use client";
import { useEffect, useState } from "react";

type Data = {
  at: string; target: number;
  users: { total: number; lastHour: number; last10: number; pro: number };
  scans: { done: number; active: number; unlocked: number };
  projects: number; dbChecks: number; payments: number;
  watch: { at: string; checked?: number; changed?: number; scanned?: number } | null;
  recent: { who: string; at: string; pro: boolean }[];
  buckets: { t: string; n: number }[];
};

const ist = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const ago = (iso: string, now: number) => { const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`; };

export default function LiveBoard({ initial }: { initial: Data }) {
  const [data, setData] = useState<Data>(initial);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/admin/live/data", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as Data;
        if (alive) { setData(d); setErr(null); }
      } catch (e) { if (alive) setErr((e as Error).message); }
    };
    const poll = setInterval(pull, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, []);

  const pct = Math.min(100, Math.round((data.users.total / data.target) * 100));
  const maxB = Math.max(1, ...data.buckets.map((b) => b.n));

  return (
    <div className="live">
      <div className="live-hero panel">
        <div>
          <div className="eyebrow">Signed-in users · live</div>
          <div className="live-big">{data.users.total}<span className="live-target"> / {data.target}</span></div>
          <div className="live-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {data.users.total >= data.target ? "Target reached." : `${data.target - data.users.total} more to reach 20 free users.`} Test accounts excluded.
          </div>
        </div>
        <dl className="live-side">
          <div><dt>Last 10 min</dt><dd>{data.users.last10}</dd></div>
          <div><dt>Last hour</dt><dd>{data.users.lastHour}</dd></div>
          <div><dt>Pro / unlocked</dt><dd>{data.users.pro} / {data.scans.unlocked}</dd></div>
        </dl>
      </div>

      <div className="live-grid">
        <div className="panel"><div className="muted">Audits set up</div><div className="live-num">{data.projects}</div></div>
        <div className="panel"><div className="muted">Reports done</div><div className="live-num">{data.scans.done}</div></div>
        <div className="panel"><div className="muted">Scans running</div><div className="live-num">{data.scans.active}</div></div>
        <div className="panel"><div className="muted">Database checks</div><div className="live-num">{data.dbChecks}</div></div>
        <div className="panel"><div className="muted">Payments / unlocks</div><div className="live-num">{data.payments}</div></div>
        <div className="panel"><div className="muted">Drift Watch agent</div><div className="live-num" style={{ fontSize: 16, marginTop: 6 }}>{data.watch ? `${ago(data.watch.at, now)} · ${data.watch.checked ?? 0} repos, ${data.watch.changed ?? 0} changed` : "no run yet"}</div></div>
      </div>

      <div className="live-two">
        <section className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Signups per 10 minutes, last 3 hours</h2>
          {data.buckets.length === 0 ? <p className="muted">No signups in the last 3 hours.</p> : (
            <div className="live-chart" role="img" aria-label="Signups per 10 minutes">
              {data.buckets.map((b) => (
                <div key={b.t} className="live-col" title={`${b.t.slice(11)} UTC: ${b.n}`}>
                  <span className="live-val">{b.n}</span>
                  <i style={{ height: `${Math.round((b.n / maxB) * 100)}%` }} />
                  <span className="live-lbl">{new Date(b.t + ":00Z").toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Latest signups</h2>
          {data.recent.length === 0 ? <p className="muted">Nobody yet.</p> : (
            <ol className="live-list">
              {data.recent.map((u) => (
                <li key={u.who + u.at}><span>{u.who}{u.pro && <span className="rp-pill pro" style={{ marginLeft: 6 }}>Pro</span>}</span><span className="muted">{ago(u.at, now)}</span></li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Updated {ago(data.at, now)} ({ist.format(new Date(data.at))} IST). Refreshes every 10 seconds.{err && <span style={{ color: "var(--bad)" }}> Last refresh failed: {err}</span>}
      </p>
    </div>
  );
}
