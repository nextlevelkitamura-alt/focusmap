#!/bin/bash
# Codex Stop hook: commit repository changes when a work session finishes.
#
# This preserves completed local work without pushing. Deployment only happens
# through an explicit push to main, so local commits alone do not deploy.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_DIR="${CODEX_PROJECT_DIR:-}"

if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"
fi

cd "$REPO_DIR" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

git add -A
git commit -m "auto: Codex作業を自動コミット ($(date '+%Y-%m-%d %H:%M'))" >/dev/null 2>&1 || true

exit 0
