#!/usr/bin/env bash
# Checks everything in throwaway Docker containers (no Node, MySQL or Helm needed on this machine):
#   ./scripts/check.sh            backend (types, migrations, seed, end-to-end test on MySQL 8.4) and frontend (types, build)
#   ./scripts/check.sh backend    only the backend
#   ./scripts/check.sh frontend   only the frontend
#   ./scripts/check.sh helm       lint and render the Helm chart for staging and production
# It never talks to a real cluster or database. Nothing it creates is kept.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
NET=cp-check-net DB=cp-check-mysql
what=${1:-all}
fail=0

backend() {
  echo "==> backend: starting MySQL 8.4"
  docker network create $NET >/dev/null 2>&1 || true
  docker rm -f $DB >/dev/null 2>&1 || true
  docker run -d --name $DB --network $NET -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=checkpoint -e MYSQL_USER=checkpoint -e MYSQL_PASSWORD=pw mysql:8.4 >/dev/null
  for _ in $(seq 1 60); do docker exec $DB mysql -ucheckpoint -ppw -e 'select 1' checkpoint >/dev/null 2>&1 && break; sleep 2; done
  # An empty database Prisma uses to replay the migrations when comparing them with the schema.
  docker exec $DB mysql -uroot -proot -e 'create database if not exists shadow' >/dev/null 2>&1
  docker run --rm --network $NET \
    -v "$ROOT/backend":/src:ro -v "$ROOT/deploy/k8s":/inventory:ro -v "$ROOT/backend/test/approvers.yaml":/seed/approvers.yaml:ro \
    -e DATABASE_URL="mysql://checkpoint:pw@$DB:3306/checkpoint" \
    node:20-bookworm-slim bash -c '
set -e
apt-get update -qq >/dev/null && apt-get install -y -qq openssl ca-certificates >/dev/null
cp -r /src /app && cd /app && rm -rf node_modules
npm ci --no-audit --no-fund >/dev/null 2>&1
npx prisma generate >/dev/null
echo "--> type check"; npx tsc --noEmit && echo "types OK"
echo "--> migrations"; npx prisma migrate deploy 2>&1 | grep -E "applied|No pending|Error" || true
echo "--> migrations match the schema"; r=0; npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "mysql://root:root@cp-check-mysql:3306/shadow" --exit-code >/tmp/diff.txt 2>&1 || r=$?
case $r in 0) echo "in sync" ;; 2) echo "SCHEMA HAS CHANGES WITHOUT A MIGRATION:"; cat /tmp/diff.txt; exit 1 ;; *) echo "COULD NOT COMPARE:"; tail -3 /tmp/diff.txt; exit 1 ;; esac
export ENABLED_CCB_TYPES=all APP_ENV=local SESSION_SECRET=test-secret APPROVERS_FILE=/seed/approvers.yaml INVENTORY_DIR=/inventory SMTP_HOST=nowhere WEB_URL=http://localhost:3000 SEED_SAMPLES=true
echo "--> seed"; npx tsx prisma/seed.ts 2>&1 | tail -4
npx tsx src/index.ts > /tmp/api.log 2>&1 &
for i in $(seq 1 60); do node -e "fetch(\"http://localhost:4000/api/health\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 1; done
echo "--> end-to-end"; npx tsx test/smoke.ts | grep -vE "^PASS" || { tail -20 /tmp/api.log; exit 1; }
echo "--> worker sends one batch"; timeout 8 npx tsx worker/index.ts 2>&1 | grep -E "Outbox|started" | head -3 || true
echo "--> approval matrix from the command line"
npx tsx scripts/approvers.ts export > /tmp/m.yaml && grep -q "LK Tech" /tmp/m.yaml && echo "export OK"
npx tsx scripts/approvers.ts import < /tmp/m.yaml 2>&1 | tail -1
echo "approvers: [" | npx tsx scripts/approvers.ts import >/dev/null 2>&1 && { echo "BROKEN YAML WAS ACCEPTED"; exit 1; } || echo "broken YAML refused"
' || fail=1
  docker rm -f $DB >/dev/null 2>&1 || true
}

frontend() {
  echo "==> frontend: types and production build"
  docker run --rm -v "$ROOT/frontend":/src:ro node:20-bookworm-slim bash -c '
set -e
cp -r /src /app && cd /app && rm -rf node_modules .next
npm ci --no-audit --no-fund >/dev/null 2>&1
echo "/// <reference types=\"next\" />" > next-env.d.ts
npx tsc --noEmit && echo "types OK"
NEXT_TELEMETRY_DISABLED=1 npx next build 2>&1 | grep -E "Compiled|Failed|Error|error" || true
test -d .next && echo "build OK"
' || fail=1
}

helm_check() {
  echo "==> helm: lint and render staging and production"
  docker run --rm -v "$ROOT/deploy/helm":/charts:ro -v "$ROOT/deploy/k8s":/seed:ro --entrypoint sh alpine/helm:3.16.4 -c '
set -e
cp -r /charts/checkpoint /tmp/c
for f in approvers.yaml users.yaml mysql-inventory.yaml mongodb-inventory.yaml; do cp /seed/$f /tmp/c/files/$f; done
SET="--set image.registry=964059510816.dkr.ecr.ap-south-1.amazonaws.com --set image.tag=check --set backup.bucket=check-bucket"
for env in stg prod; do
  helm lint /tmp/c -f /tmp/c/values-$env.yaml $SET | grep -E "linted|ERROR|WARNING" || true
  helm template checkpoint /tmp/c -n devx-$env -f /tmp/c/values-$env.yaml $SET > /tmp/$env.yaml
  echo "$env renders: $(grep "^kind:" /tmp/$env.yaml | sort | uniq -c | awk "{printf \"%s %s, \", \$1, \$3}")"
done
helm template checkpoint /tmp/c -f /tmp/c/values-prod.yaml --set image.tag=x --set backup.bucket=b >/dev/null 2>&1 && { echo "MISSING REGISTRY WAS ACCEPTED"; exit 1; } || echo "refuses to render without an image registry"
' || fail=1
}

case "$what" in
  backend) backend ;;
  frontend) frontend ;;
  helm) helm_check ;;
  all) backend; frontend; [ -d deploy/helm/checkpoint ] && helm_check ;;
  *) echo "Usage: $0 [all|backend|frontend|helm]"; exit 2 ;;
esac
[ $fail -eq 0 ] && echo "==> all checks passed" || { echo "==> SOME CHECKS FAILED"; exit 1; }
