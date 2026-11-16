#!/usr/bin/env bash
# Checkpoint on AWS EKS (lk-tech-infra-02-eks, ap-south-1), with Helm.   ./scripts/eks.sh help
#
# Order for a new environment (stg first, then prod):
#   ./scripts/eks.sh preflight              what the cluster has and is missing
#   ./scripts/eks.sh ecr                    create the two image repositories (once)
#   ./scripts/eks.sh build                  build both images (amd64 + arm64) and push them; prints the tag
#   ./scripts/eks.sh namespaces             create devx-stg and devx-prod (once)
#   ./scripts/eks.sh backup-access stg      S3 bucket access for the backup job, through EKS Pod Identity (once per env)
#   ./scripts/eks.sh secrets stg            database passwords, session secret, Google and SES credentials (once per env)
#   ./scripts/eks.sh deploy stg <tag>       install or upgrade
#   ./scripts/eks.sh backup-now stg         run a backup now and check it reached S3
#
# Stopping and starting again (the data, secrets and settings are kept):
#   ./scripts/eks.sh pause stg              scale everything to zero; the nodes go away by themselves
#   ./scripts/eks.sh resume stg <tag>       bring it all back
#   ./scripts/eks.sh remove-samples stg     list the sample CCBs and remove them if you type yes
#
# Every kubectl, helm and aws call names the cluster, account and region explicitly, whatever your current
# kubectl context or AWS profile is. Anything that touches prod asks you to type the environment name first.
set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT=964059510816
REGION=ap-south-1
CLUSTER=lk-tech-infra-02-eks
CTX="arn:aws:eks:${REGION}:${ACCOUNT}:cluster/${CLUSTER}"   # braces: zsh reads $ACCOUNT:c as a modifier
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
RELEASE=checkpoint
CHART=deploy/helm/checkpoint
REPOS=(checkpoint-backend checkpoint-frontend)
# The S3 bucket for database dumps. Must exist (with versioning and a lifecycle rule; see docs/EKS.md).
BACKUP_BUCKET=${BACKUP_BUCKET:-}

kc() { kubectl --context "$CTX" "$@"; }
hm() { helm --kube-context "$CTX" "$@"; }
aw() { aws --region "$REGION" "$@"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1"; exit 1; }; }
say() { printf '\n==> %s\n' "$*"; }
ns_of() { case "${1:-}" in stg) echo devx-stg ;; prod) echo devx-prod ;; *) echo "Environment must be stg or prod" >&2; exit 2 ;; esac; }
confirm() { # confirm <env> <what>
  local a
  [ "$1" = prod ] || return 0
  read -r -p "This $2 in PRODUCTION (devx-prod). Type prod to continue: " a
  [ "$a" = prod ] || { echo "Cancelled."; exit 1; }
}
check_account() {
  local acct
  acct=$(aw sts get-caller-identity --query Account --output text 2>/dev/null) || { echo "No AWS credentials. Sign in first (aws sso login, or aws configure)."; exit 1; }
  [ "$acct" = "$ACCOUNT" ] || { echo "These AWS credentials are for account $acct, not $ACCOUNT. Stopping."; exit 1; }
}

case "${1:-help}" in
  preflight) # read only: what the cluster has
    need aws; need kubectl; check_account
    aw eks update-kubeconfig --name "$CLUSTER" --alias "$CTX" >/dev/null
    # A missing object is a finding, not a failure: every check here reports instead of stopping the script.
    say "Nodes";             kc get nodes -L karpenter.sh/nodepool,node.kubernetes.io/instance-type,topology.kubernetes.io/zone || true
    say "Karpenter";         { kc get nodepools,ec2nodeclasses 2>&1 || true; } | head -20
    say "metrics-server (the HPAs need it)"; { kc -n kube-system get deploy 2>&1 | grep -iE "metrics|NAME" || echo "no metrics-server deployment"; } | head -3
    say "AWS Load Balancer Controller (the Ingress needs it)"; kc get ingressclass 2>&1 || true; { kc -n kube-system get deploy aws-load-balancer-controller 2>&1 || true; } | tail -1
    say "EBS CSI driver";    kc get csidrivers ebs.csi.aws.com 2>&1 || true
    say "Network policies in the VPC CNI"; { kc -n kube-system get ds aws-node -o jsonpath='{.spec.template.spec.containers[*].args}' 2>/dev/null | grep -o 'enable-network-policy=[a-z]*' || echo "not enabled (the chart's NetworkPolicy is then not enforced)"; }
    say "Namespaces";        kc get ns 2>&1 | grep -E "devx|NAME" || echo "neither devx-stg nor devx-prod exists yet"
    say "Storage classes";   kc get storageclass 2>&1 || true
    ;;

  ecr) # create the image repositories (once)
    need aws; check_account
    for r in "${REPOS[@]}"; do
      if aw ecr describe-repositories --repository-names "$r" >/dev/null 2>&1; then echo "$r exists"; continue; fi
      aw ecr create-repository --repository-name "$r" --image-tag-mutability IMMUTABLE \
        --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 >/dev/null
      # Keep the newest 30 images.
      aw ecr put-lifecycle-policy --repository-name "$r" --lifecycle-policy-text \
        '{"rules":[{"rulePriority":1,"description":"keep 30","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":30},"action":{"type":"expire"}}]}' >/dev/null
      echo "$r created"
    done
    ;;

  build) # build both images for amd64 and arm64 and push them. ./scripts/eks.sh build [tag]
    need aws; need docker; check_account
    TAG=${2:-$(date -u +%Y%m%d-%H%M)}
    aw ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
    docker buildx inspect checkpoint-builder >/dev/null 2>&1 || docker buildx create --name checkpoint-builder >/dev/null
    for part in backend frontend; do
      say "Building checkpoint-$part:$TAG (linux/amd64, linux/arm64)"
      docker buildx build --builder checkpoint-builder --platform linux/amd64,linux/arm64 \
        -t "$REGISTRY/checkpoint-$part:$TAG" --push "$part/"
    done
    echo; echo "Pushed. Deploy with:  ./scripts/eks.sh deploy stg $TAG"
    ;;

  namespaces) # create devx-stg and devx-prod (once)
    need kubectl
    for ns in devx-stg devx-prod; do
      kc create namespace "$ns" --dry-run=client -o yaml | kc apply -f -
      # Pod Security: block privileged pods; warn about anything short of "restricted" (the chart meets it).
      kc label namespace "$ns" --overwrite pod-security.kubernetes.io/enforce=baseline pod-security.kubernetes.io/warn=restricted team=devx >/dev/null
    done
    kc get ns devx-stg devx-prod
    ;;

  backup-access) # ./scripts/eks.sh backup-access stg   IAM role + Pod Identity so the backup job can write to S3
    need aws; check_account
    ENV=${2:-}; NS=$(ns_of "$ENV"); confirm "$ENV" "creates an IAM role and a Pod Identity association"
    [ -n "$BACKUP_BUCKET" ] || { echo "Set BACKUP_BUCKET (the S3 bucket for dumps), for example: BACKUP_BUCKET=lk-devx-checkpoint-backups $0 backup-access $ENV"; exit 1; }
    ROLE="checkpoint-backup-$ENV"
    if ! aw iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
      aw iam create-role --role-name "$ROLE" --description "Checkpoint MySQL backups ($NS)" --assume-role-policy-document \
        '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"pods.eks.amazonaws.com"},"Action":["sts:AssumeRole","sts:TagSession"]}]}' >/dev/null
    fi
    # Write only, and only under this environment's folder. No delete: old dumps expire by the bucket's lifecycle rule.
    aw iam put-role-policy --role-name "$ROLE" --policy-name s3-write --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
      {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:AbortMultipartUpload\"],\"Resource\":\"arn:aws:s3:::$BACKUP_BUCKET/checkpoint/$NS/*\"},
      {\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":\"arn:aws:s3:::$BACKUP_BUCKET\",\"Condition\":{\"StringLike\":{\"s3:prefix\":[\"checkpoint/$NS/*\"]}}}]}"
    # Count the associations rather than looking for any output: with no associations, --output text prints the word
    # "None", which is not empty, so an earlier version of this check thought the association already existed and
    # skipped creating it.
    have=$(aw eks list-pod-identity-associations --cluster-name "$CLUSTER" --namespace "$NS" --service-account checkpoint-backup \
      --query 'length(associations)' --output text 2>/dev/null || echo 0)
    if [ "${have:-0}" = 0 ]; then
      aw eks create-pod-identity-association --cluster-name "$CLUSTER" --namespace "$NS" --service-account checkpoint-backup \
        --role-arn "arn:aws:iam::${ACCOUNT}:role/${ROLE}" >/dev/null
      echo "Pod Identity association created: $NS/checkpoint-backup -> $ROLE"
    else
      echo "Pod Identity association for $NS/checkpoint-backup already exists"
    fi
    echo "Backup job in $NS can now write to s3://$BACKUP_BUCKET/checkpoint/$NS/"
    ;;

  secrets) # ./scripts/eks.sh secrets stg   creates checkpoint-secrets once; never prints a value
    need kubectl; need openssl
    ENV=${2:-}; NS=$(ns_of "$ENV")
    if kc -n "$NS" get secret checkpoint-secrets >/dev/null 2>&1; then
      echo "checkpoint-secrets already exists in $NS. To change one value:"
      echo "  kubectl --context $CTX -n $NS patch secret checkpoint-secrets -p '{\"stringData\":{\"SMTP_PASS\":\"...\"}}'"
      echo "  kubectl --context $CTX -n $NS patch secret checkpoint-secrets -p '{\"stringData\":{\"OIDC_CLIENT_ID\":\"...\",\"OIDC_CLIENT_SECRET\":\"...\"}}'"
      echo "Never regenerate MYSQL_PASSWORD or MYSQL_ROOT_PASSWORD: the database already uses them."
      exit 0
    fi
    confirm "$ENV" "creates the secrets"
    read -r -p "Google OAuth client ID: " GID
    read -r -s -p "Google OAuth client secret: " GSECRET; echo
    read -r -p "SES SMTP user (blank to set later): " SUSER
    read -r -s -p "SES SMTP password (blank to set later): " SPASS; echo
    read -r -p "Company IdP OAuth client ID (blank to set later): " OIDCID
    read -r -s -p "Company IdP OAuth client secret (blank to set later): " OIDCSECRET; echo
    DBPW=$(openssl rand -hex 24); ROOTPW=$(openssl rand -hex 24); SESSION=$(openssl rand -base64 48 | tr -d '\n')
    kc -n "$NS" create secret generic checkpoint-secrets \
      --from-literal=MYSQL_PASSWORD="$DBPW" --from-literal=MYSQL_ROOT_PASSWORD="$ROOTPW" \
      --from-literal=DATABASE_URL="mysql://checkpoint:$DBPW@$RELEASE-mysql:3306/checkpoint?connection_limit=10" \
      --from-literal=SESSION_SECRET="$SESSION" \
      --from-literal=GOOGLE_CLIENT_ID="$GID" --from-literal=GOOGLE_CLIENT_SECRET="$GSECRET" \
      --from-literal=SMTP_USER="$SUSER" --from-literal=SMTP_PASS="$SPASS" \
      --from-literal=OIDC_CLIENT_ID="$OIDCID" --from-literal=OIDC_CLIENT_SECRET="$OIDCSECRET" >/dev/null
    echo "checkpoint-secrets created in $NS. Keep a copy of the database passwords in your password manager:"
    echo "  kubectl --context $CTX -n $NS get secret checkpoint-secrets -o jsonpath='{.data.MYSQL_ROOT_PASSWORD}' | base64 -d"
    ;;

  deploy|resume) # ./scripts/eks.sh deploy stg <tag>   install or upgrade;  ./scripts/eks.sh resume stg <tag>   the same, after a pause
    need helm; need kubectl
    ENV=${2:-}; NS=$(ns_of "$ENV"); TAG=${3:-}
    [ -n "$TAG" ] || { echo "Usage: $0 $1 <stg|prod> <image tag from build>"; exit 2; }
    kc -n "$NS" get secret checkpoint-secrets >/dev/null 2>&1 || { echo "No checkpoint-secrets in $NS. Run: $0 secrets $ENV"; exit 1; }
    confirm "$ENV" "upgrades the release to $TAG"
    # The chart can only read files inside itself: copy the starting files in.
    for f in approvers.yaml users.yaml mysql-inventory.yaml mongodb-inventory.yaml; do cp "deploy/k8s/$f" "$CHART/files/$f"; done
    say "helm upgrade --install $RELEASE ($NS, $TAG)"
    hm upgrade --install "$RELEASE" "$CHART" -n "$NS" -f "$CHART/values-$ENV.yaml" \
      --set image.registry="$REGISTRY" --set image.tag="$TAG" ${BACKUP_BUCKET:+--set backup.bucket="$BACKUP_BUCKET"} \
      --rollback-on-failure --wait --timeout 15m
    if [ "$1" = resume ]; then
      # pause scaled the backend and frontend to zero and removed their autoscalers. Helm brings the autoscalers back,
      # but leaves a Deployment that is at zero alone, and an autoscaler never scales up from zero. So set them to one.
      for d in backend frontend; do
        [ "$(kc -n "$NS" get deploy "$RELEASE-$d" -o jsonpath='{.spec.replicas}')" != 0 ] || kc -n "$NS" scale "deploy/$RELEASE-$d" --replicas=1
      done
      for d in backend frontend worker; do kc -n "$NS" rollout status "deploy/$RELEASE-$d" --timeout=10m; done
    fi
    kc -n "$NS" get pods,ingress
    ;;

  pause) # ./scripts/eks.sh pause stg   stop everything, keep the data
    need kubectl; ENV=${2:-}; NS=$(ns_of "$ENV"); confirm "$ENV" "scales everything down, so the app is unavailable"
    # The autoscalers go first, or they would scale the backend and frontend straight back up.
    kc -n "$NS" delete hpa "$RELEASE-backend" "$RELEASE-frontend" --ignore-not-found
    kc -n "$NS" scale deploy --all --replicas=0
    kc -n "$NS" scale statefulset --all --replicas=0
    echo "Paused. Karpenter removes the empty node in about 10 minutes. The database volume stays (about \$1 a month)."
    echo "Bring it back with:  $0 resume $ENV <tag>"
    ;;

  remove-samples) # ./scripts/eks.sh remove-samples stg   lists the sample CCBs, then removes them if you type yes
    need kubectl; ENV=${2:-}; NS=$(ns_of "$ENV")
    run() { kc -n "$NS" exec "deploy/$RELEASE-backend" -c api -- npx tsx scripts/remove-samples.ts "$@"; }
    out=$(run); echo "$out"
    echo "$out" | grep -q "found:" || exit 0
    confirm "$ENV" "removes the sample CCBs"
    read -r -p "Remove these CCBs, with their approvals and comments? Type yes: " a
    [ "$a" = yes ] || { echo "Cancelled."; exit 0; }
    run --yes
    ;;

  rollback) # ./scripts/eks.sh rollback stg [revision]   back to the previous (or given) release
    need helm; ENV=${2:-}; NS=$(ns_of "$ENV"); confirm "$ENV" "rolls the release back"
    hm -n "$NS" history "$RELEASE" --max 5
    hm -n "$NS" rollback "$RELEASE" ${3:-} --wait --timeout 10m
    ;;

  status) # ./scripts/eks.sh status stg
    need kubectl; need helm; ENV=${2:-}; NS=$(ns_of "$ENV")
    hm -n "$NS" status "$RELEASE" | head -8
    kc -n "$NS" get pods,hpa,pvc,ingress,cronjob -o wide
    ;;

  logs) # ./scripts/eks.sh logs stg backend|worker|frontend|mysql
    need kubectl; ENV=${2:-}; NS=$(ns_of "$ENV")
    case "${3:-backend}" in mysql) kc -n "$NS" logs -f "statefulset/$RELEASE-mysql" ;; *) kc -n "$NS" logs -f "deploy/$RELEASE-${3:-backend}" --all-containers ;; esac
    ;;

  backup-now) # ./scripts/eks.sh backup-now stg   run the backup job now and wait for it
    need kubectl; ENV=${2:-}; NS=$(ns_of "$ENV")
    JOB="$RELEASE-backup-manual-$(date -u +%Y%m%d%H%M%S)"
    kc -n "$NS" create job "$JOB" --from="cronjob/$RELEASE-mysql-backup"
    kc -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=30m
    kc -n "$NS" logs "job/$JOB" --all-containers | tail -5
    ;;

  approvers-export) # ./scripts/eks.sh approvers-export stg   save the live approval matrix into deploy/k8s/approvers.yaml
    need kubectl; ENV=${2:-}; NS=$(ns_of "$ENV")
    kc -n "$NS" exec "deploy/$RELEASE-backend" -c api -- npx tsx scripts/approvers.ts export > deploy/k8s/approvers.yaml.new
    [ -s deploy/k8s/approvers.yaml.new ] && mv deploy/k8s/approvers.yaml.new deploy/k8s/approvers.yaml && echo "Saved into deploy/k8s/approvers.yaml"
    ;;

  sql) # ./scripts/eks.sh sql stg   a MySQL prompt (as the app user)
    need kubectl; ENV=${2:-}; NS=$(ns_of "$ENV"); confirm "$ENV" "opens a database prompt"
    kc -n "$NS" exec -it "statefulset/$RELEASE-mysql" -- sh -c 'mysql -ucheckpoint -p"$MYSQL_PASSWORD" checkpoint'
    ;;

  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    cat <<'TXT'

Also:  status <env> · logs <env> <part> · rollback <env> [rev] · approvers-export <env> · sql <env>
Set BACKUP_BUCKET=<bucket> for backup-access and deploy.
TXT
    ;;
esac
