#!/usr/bin/env bash
# Push every KEY=value line of a local env file into Vercel project env vars (production by default).
# Usage: scripts/vercel-env.sh [.env.deploy.local] [production|preview|development]
# Existing values are replaced. Values are never echoed.
set -euo pipefail
FILE="${1:-.env.deploy.local}"
TARGET="${2:-production}"
[ -f "$FILE" ] || { echo "missing $FILE" >&2; exit 1; }
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue;; esac
  key="${line%%=*}"; val="${line#*=}"
  [ -z "$key" ] && continue
  npx vercel env rm "$key" "$TARGET" --yes >/dev/null 2>&1 || true
  if printf '%s' "$val" | npx vercel env add "$key" "$TARGET" >/dev/null 2>&1; then
    echo "set  $key"
  else
    echo "FAIL $key" >&2
  fi
done < "$FILE"
