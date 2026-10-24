"use client";

import { useState } from "react";

export default function InterestButton(props: {
  plan: "single" | "monthly";
  scanId?: string;
  hasEmail: boolean;
  already: boolean;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">(props.already ? "done" : "idle");
  const [needsEmail, setNeedsEmail] = useState(!props.hasEmail);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("busy");
    try {
      const res = await fetch("/api/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: props.plan, scanId: props.scanId, email: email || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent("/pricing")}`;
        return;
      }
      if (!res.ok) {
        if (data.needsEmail) setNeedsEmail(true);
        throw new Error(data.error ?? "Something went wrong. Try again.");
      }
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p className="notice good" style={{ margin: 0 }} role="status">
        <strong>You're on the list.</strong> We'll email you when this plan opens.
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      {needsEmail && (
        <input
          type="email"
          required
          aria-label="Your email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      )}
      <button type="submit" className={`btn${props.variant === "secondary" ? " secondary" : ""}`} disabled={state === "busy"}>
        {state === "busy" ? "Saving…" : props.label ?? "I'm interested"}
      </button>
      {error && <span style={{ color: "var(--bad)", fontSize: ".86rem" }}>{error}</span>}
    </form>
  );
}
