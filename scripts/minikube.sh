aws sts get-caller-identity
aws configure get region#!/usr/bin/env bash
# One-stop helper for running Checkpoint on minikube.   ./scripts/minikube.sh help
set -euo pipefail
cd "$(dirname "$0")/.."
NS=checkpoint
BACKEND_IMG=checkpoint-backend:local
FRONTEND_IMG=checkpoint-frontend:local

# Every kubectl call below goes to minikube and nowhere else, whatever kubectl's current context is. Without this, a
# different current context (for example a company EKS cluster) would receive these deployments, and "reset" would
# delete a namespace there.
kc() { kubectl --context minikube "$@"; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1. See docs/GUIDE.md, step 1."; exit 1; }; }

# ---- progress output: a timestamp on every step, and a heartbeat while a long step runs ----
T0=$(date +%s)
elapsed() { local s=$(( $(date +%s) - T0 )); printf '%dm%02ds' $((s / 60)) $((s % 60)); }
say() { printf '\n[%s] ==> %s\n' "$(elapsed)" "$*"; }
pods() { kc -n $NS get pods --no-headers 2>/dev/null | awk '{ printf "        %-44s ready %-5s %-18s restarts %s\n", $1, $2, $3, $4 }' || true; }
# beat "what is running" command...   Every 15 seconds it says it is still working and lists the pods.
beat() {
  local label="$1" rc=0; shift
  ( while sleep 15; do printf '    ... %s, still working (%s)\n' "$label" "$(elapsed)"; pods; done ) &
  local hb=$!
  if "$@"; then rc=0; else rc=$?; fi
  kill "$hb" 2>/dev/null || true; wait "$hb" 2>/dev/null || true
  return $rc
}

build_images() {
  # "minikube image build" builds inside the cluster, so it works whatever runtime minikube uses
  # and does not depend on your own Docker's build settings. The first build downloads packages: a few minutes each.
  say "Building the backend image inside minikube (1 of 2)"
  beat "building the backend image" minikube image build -t "$BACKEND_IMG" backend/
  say "Building the frontend image inside minikube (2 of 2)"
  beat "building the frontend image" minikube image build -t "$FRONTEND_IMG" frontend/
}

restart_apps() { kc -n $NS rollout restart deploy/checkpoint-backend deploy/checkpoint-worker deploy/checkpoint-frontend >/dev/null; }

wait_ready() {
  say "Waiting for the database"
  beat "database starting" kc -n $NS rollout status statefulset/checkpoint-db --timeout=240s
  say "Waiting for the backend (it creates the tables first, this can take a minute)"
  beat "backend starting" kc -n $NS rollout status deploy/checkpoint-backend --timeout=420s
  say "Waiting for the worker"
  beat "worker starting" kc -n $NS rollout status deploy/checkpoint-worker --timeout=240s
  say "Waiting for the frontend"
  beat "frontend starting" kc -n $NS rollout status deploy/checkpoint-frontend --timeout=240s
  say "Waiting for the mail catcher"
  beat "mail catcher starting" kc -n $NS rollout status deploy/checkpoint-mail --timeout=120s
  say "Everything is up"
  pods
}

case "${1:-help}" in
  up)
    need docker; need minikube; need kubectl
    if ! minikube status >/dev/null 2>&1; then
      say "Starting minikube (the first time this downloads about 500 MB)"
      minikube start --driver=docker --container-runtime=docker --cpus=2 --memory=4096
    fi
    build_images
    say "Applying the Kubernetes manifests"
    kc apply -k deploy/k8s
    # Pick up freshly built images when re-running.
    restart_apps
    wait_ready
    echo
    echo "Ready in $(elapsed). Next:  ./scripts/minikube.sh open"
    ;;
  rebuild)   # after you change code: ./scripts/minikube.sh rebuild [frontend|backend]
    need minikube; need kubectl
    case "${2:-all}" in
      frontend) minikube image build -t "$FRONTEND_IMG" frontend/; kc -n $NS rollout restart deploy/checkpoint-frontend ;;
      backend)  minikube image build -t "$BACKEND_IMG" backend/;   kc -n $NS rollout restart deploy/checkpoint-backend deploy/checkpoint-worker ;;
      *)        build_images; restart_apps ;;
    esac
    wait_ready
    ;;
  apply)     # after editing anything in deploy/k8s (users.yaml, inventories, config): apply and restart
    need kubectl
    kc apply -k deploy/k8s
    restart_apps
    wait_ready
    ;;
  approvers-export) # save the live approvers list (edited in the UI) back into the project
    need kubectl
    kc -n $NS exec deploy/checkpoint-backend -- cat /config/approvers.yaml > deploy/k8s/approvers.yaml.new
    mv deploy/k8s/approvers.yaml.new deploy/k8s/approvers.yaml
    echo "Saved the live approvers list into deploy/k8s/approvers.yaml"
    ;;
  approvers-reset)  # replace the live approvers list with the project's copy (UI edits are lost)
    need kubectl
    read -r -p "This replaces the live approvers list with deploy/k8s/approvers.yaml. Changes made in the UI are lost. Type yes to continue: " a
    [ "$a" = "yes" ] || { echo "Cancelled."; exit 0; }
    kc -n $NS exec -i deploy/checkpoint-backend -- sh -c 'cat > /config/approvers.yaml.new && mv /config/approvers.yaml.new /config/approvers.yaml' < deploy/k8s/approvers.yaml
    echo "Done. The backend reads the new list straight away; no restart needed."
    ;;
  users-export) # save who is in Checkpoint now into users.yaml
    need kubectl
    tmp=$(mktemp)
    sed -n '1,/^users:/p' deploy/k8s/users.yaml > "$tmp"
    kc -n $NS exec statefulset/checkpoint-db -- psql -U checkpoint -d checkpoint -At -F '|' -c 'select name, email, access from "User" order by email' \
      | awk -F'|' 'NF==3 { printf "  - { name: %s, email: %s, access: %s }\n", $1, $2, $3 }' >> "$tmp"
    mv "$tmp" deploy/k8s/users.yaml
    echo "Saved who is in Checkpoint into deploy/k8s/users.yaml"
    ;;
  open)      # forward ports and keep running; Ctrl+C to stop
    need kubectl
    trap 'kill 0' EXIT
    echo "Checkpoint:   http://localhost:3000   (the frontend; it forwards /api to the backend)"
    echo "Backend API:  http://localhost:4000/api/health   (direct, handy for debugging and npm test)"
    echo "Mail viewer:  http://localhost:8025   (every email the app sends lands here)"
    echo "Press Ctrl+C to stop forwarding."
    kc -n $NS port-forward svc/checkpoint-frontend 3000:3000 &
    kc -n $NS port-forward svc/checkpoint-backend 4000:4000 &
    kc -n $NS port-forward svc/checkpoint-mail 8025:8025 &
    wait
    ;;
  status)
    need kubectl
    kc -n $NS get pods,svc,pvc
    ;;
  logs)      # ./scripts/minikube.sh logs frontend|backend|worker|db|mail
    need kubectl
    case "${2:-backend}" in
      db) kc -n $NS logs -f statefulset/checkpoint-db ;;
      *)  kc -n $NS logs -f "deploy/checkpoint-${2:-backend}" ;;
    esac
    ;;
  sync-logs) # output of the table-creation step that runs before the backend starts
    need kubectl
    kc -n $NS logs deploy/checkpoint-backend -c schema-sync
    ;;
  google)    # ./scripts/minikube.sh google CLIENT_ID CLIENT_SECRET
    need kubectl
    [ $# -eq 3 ] || { echo "Usage: $0 google <client-id> <client-secret>"; exit 1; }
    kc -n $NS create secret generic checkpoint-google \
      --from-literal=GOOGLE_CLIENT_ID="$2" --from-literal=GOOGLE_CLIENT_SECRET="$3" \
      --dry-run=client -o yaml | kc apply -f -
    kc -n $NS rollout restart deploy/checkpoint-backend deploy/checkpoint-worker
    kc -n $NS rollout status deploy/checkpoint-backend --timeout=300s
    echo "Google sign-in is now configured."
    ;;
  psql)      # open a SQL prompt inside the database pod
    need kubectl
    kc -n $NS exec -it statefulset/checkpoint-db -- psql -U checkpoint -d checkpoint
    ;;
  stop)      # pause everything, keep all data
    need minikube; minikube stop
    ;;
  reset)     # delete the app and ALL its data (the database volume too), keep minikube
    need kubectl
    read -r -p "This deletes the Checkpoint database and its volume. Type yes to continue: " a
    [ "$a" = "yes" ] && kc delete namespace $NS --wait=true
    ;;
  *)
    cat <<'TXT'
Usage: ./scripts/minikube.sh <command>

  up         start minikube, build the images, deploy everything, wait until ready
  open       forward ports: frontend :3000, backend :4000, mail viewer :8025
  status     show pods, services and volumes
  logs X     follow logs for frontend | backend | worker | db | mail
  sync-logs  show the table-creation step output (useful if the backend is stuck starting)
  apply      apply edited deploy files (users, inventories, config) and restart
  approvers-export  save the live approvers list into deploy/k8s/approvers.yaml
  approvers-reset   replace the live approvers list with deploy/k8s/approvers.yaml
  users-export      save who is in Checkpoint into deploy/k8s/users.yaml
  rebuild    rebuild both images and restart; or "rebuild frontend" / "rebuild backend" for one
  google ID SECRET   store Google sign-in credentials and restart
  psql       open a SQL prompt in the database
  stop       pause minikube (data is kept)
  reset      delete the app and its data (the database volume)
TXT
    ;;
esac
