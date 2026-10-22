#!/usr/bin/env bash
# Safe hourly-commit helper for Web Forge.
# Commits & pushes ONLY when there are real changes. It never creates empty or
# fake commits — the rules verify genuine progress, so this just makes sure your
# real work reaches GitHub on time. Run it in a terminal while you build:
#
#   bash scripts/autocommit.sh
#
# It checks every 40 minutes (safely under the 60-min rule). Ctrl+C to stop.

set -u
INTERVAL="${INTERVAL:-2400}"   # seconds (40 min)
BRANCH="${BRANCH:-main}"

while true; do
  cd "$(git rev-parse --show-toplevel)" 2>/dev/null || { echo "Not a git repo"; exit 1; }
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "chore: progress checkpoint $(date '+%H:%M')" >/dev/null 2>&1 && echo "[$(date '+%H:%M')] committed real changes"
    git pull --rebase origin "$BRANCH" >/dev/null 2>&1
    if git push origin "$BRANCH" >/dev/null 2>&1; then
      echo "[$(date '+%H:%M')] pushed to $BRANCH"
    else
      echo "[$(date '+%H:%M')] push failed — check 'git push' manually"
    fi
  else
    echo "[$(date '+%H:%M')] no changes — nothing to commit (make a real edit before the hour is up)"
  fi
  sleep "$INTERVAL"
done
