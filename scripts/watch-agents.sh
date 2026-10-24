#!/usr/bin/env bash
# Live view of AgenticOrg agent runs (and watcher runs) from production logs.
# Usage: scripts/watch-agents.sh [all]   (default shows agent lines only; "all" shows every log line)
set -u
MODE="${1:-agents}"
SEEN="$(mktemp)"
trap 'rm -f "$SEEN"' EXIT
echo "watching trilens-lac.vercel.app ... (Ctrl-C to stop)"
while true; do
  npx vercel logs trilens-lac.vercel.app --since 40s --json 2>/dev/null \
  | MODE="$MODE" python3 -c '
import sys, json, os
mode = os.environ.get("MODE", "agents")
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get("type") != "log":
        continue
    x = d.get("data", {})
    msg = str(x.get("message", "")).strip()
    ts = str(x.get("timestamp", ""))[11:19]
    path = str(x.get("requestPath", ""))[:28]
    if mode == "agents" and "agenticorg" not in msg and "watch_run" not in msg and "agent run" not in msg:
        continue
    try:
        j = json.loads(msg)
    except Exception:
        j = None
    if isinstance(j, dict) and j.get("tag") == "agenticorg":
        parts = [j.get("event"), j.get("action")]
        if j.get("ms") is not None: parts.append(str(j.get("ms")) + "ms")
        if j.get("status"): parts.append(str(j.get("status")))
        if j.get("runId"): parts.append("run=" + str(j.get("runId")))
        if j.get("confidence") is not None: parts.append("conf=" + str(j.get("confidence")))
        if j.get("outputKeys"): parts.append("out=" + str(j.get("outputKeys")))
        if j.get("error"): parts.append("ERR " + str(j.get("error")))
        msg = " ".join(str(p) for p in parts if p)
    print(ts + " " + path.ljust(28) + " " + msg[:300])
' \
  | while IFS= read -r l; do
      if ! grep -qxF -- "$l" "$SEEN" 2>/dev/null; then echo "$l"; echo "$l" >> "$SEEN"; fi
    done
  sleep 10
done
