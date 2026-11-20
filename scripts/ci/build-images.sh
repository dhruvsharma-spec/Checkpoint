#!/usr/bin/env bash
# Build and push backend + frontend images to ECR. Writes build.env (IMAGE_TAG=…) for the deploy job.
set -euo pipefail
cd "$(dirname "$0")/../.."
TAG="${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M)}"
export CI=true
./scripts/eks.sh build "$TAG"
OUT="${CI_PROJECT_DIR:-$PWD}/build.env"
echo "IMAGE_TAG=$TAG" | tee "$OUT"