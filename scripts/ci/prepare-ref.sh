#!/usr/bin/env bash
# Check out the ref requested when the pipeline was started (branch or tag).
set -euo pipefail
cd "$(dirname "$0")/../.."
REF="${GIT_REF:-${CI_COMMIT_REF_NAME:-main}}"
if [ -z "${CI:-}" ]; then
  echo "Not in CI; using the current working tree."
  exit 0
fi
echo "==> checkout $REF"
git fetch --depth 1 origin "$REF"
git checkout "$REF"