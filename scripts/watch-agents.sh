#!/usr/bin/env bash
# Live view of AgenticOrg agent runs (and watcher runs) from production logs.
# Usage: scripts/watch-agents.sh [all]   (default shows agent lines only; "all" shows every log line)
set -u
MODE="${1:-agents}"
LAST=""
echo "watching trilens-lac.vercel.app ... (Ctrl-C to stop)"
while true; do
  npx vercel logs trilens-lac.vercel.app --since 40s --json 2>/dev/null \
  | python3 -c '
import sys, json
mode = sys.argv[1]
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("{"): continue
    try: d = json.loads(line)
    except Exception: continue
    if d.get("type") != "log": continue
    x = d.get("data", {})
    msg = str(x.get("message", "")).strip()
    ts = str(x.get("timestamp", ""))[11:19]
    path = x.get("requestPath", "")
    if mode == "agents" and "agenticorg" not in msg and "watch_run" not in msg and "agent run" not in msg: continue
    try:
        j = json.loads(msg)
        if j.get("tag") == "agenticorg":
            parts = [j.get("event"), j.get("action"), f"{j.get(\"ms\")}ms" if j.get("ms") else None, j.get("status"), f"run={j.get(\"runId\")}" if j.get("runId") else None, f"conf={j.get(\"confidence\")}" if j.get("confidence") is not None else None, f"out={j.get(\"outputKeys\")}" if j.get("outputKeys") else None, f"ERR {j.get(\"error\")}" if j.get("error") else None]
            msg = " ".join(str(p) for p in parts if p)
    except Exception:
        pass
    print(f"{ts} {path:<28} {msg[:300]}")
' "$MODE" \
  | while IFS= read -r l; do
      if ! grep -qxF -- "$l" /tmp/.watch-agents-seen 2>/dev/null; then echo "$l"; echo "$l" >> /tmp/.watch-agents-seen; fi
    done
  sleep 10
done
