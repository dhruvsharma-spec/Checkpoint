#!/usr/bin/env bash
# Helm upgrade on EKS. Usage: ./scripts/ci/deploy-eks.sh <stg|prod> <image-tag>
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV="${1:-}"; TAG="${2:-}"
[ -n "$ENV" ] && [ -n "$TAG" ] || { echo "Usage: $0 <stg|prod> <image-tag>"; exit 2; }
export CI=true
[ "$ENV" != prod ] || [ "${CONFIRM_PROD:-}" = prod ] || {
  echo "Production deploy requires CONFIRM_PROD=prod (set it on the GitLab job when you run deploy:prod).";
  exit 1;
}
./scripts/eks.sh deploy "$ENV" "$TAG"