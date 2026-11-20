# CI/CD (GitLab)

Checkpoint ships a **manual** GitLab pipeline: you choose the branch, optionally run checks, build multi-arch images to ECR, then deploy to EKS with Helm — the same paths as `./scripts/eks.sh`.

## Prerequisites

1. **GitLab project** with this repo and a runner that supports **Docker-in-Docker** (privileged runner for the `build:images` job).
2. **AWS credentials** in **Settings → CI/CD → Variables** (masked / protected as appropriate):
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` if using temporary keys
   - Account must be `964059510816`; region `ap-south-1`
   - Permissions: ECR push, `eks:DescribeCluster`, `eks:ListClusters`, and Kubernetes access to `devx-stg` / `devx-prod` (same as local `eks.sh`)
3. **One-time cluster setup** already done (`secrets`, `namespaces`, ALB, etc.) — see `docs/EKS.md`.
4. Optional: `BACKUP_BUCKET` if Helm needs it on deploy (same as local `eks.sh deploy`).

## Run a pipeline

1. **Build → Pipelines → Run pipeline**
2. Inputs:
   - **git_ref** — branch or tag to build (default `main`)
   - **image_tag** — leave empty to auto-use `YYYYMMDD-HHMM` UTC at build time
   - **deploy_env** — `stg` or `prod` (only the matching deploy job appears)
3. Click **Run pipeline**, then **Play** on each stage you want:
   - **verify** — `./scripts/check.sh` in Docker (optional but recommended)
   - **build:images** — pushes `checkpoint-backend` and `checkpoint-frontend` to ECR; passes `IMAGE_TAG` to deploy via dotenv artifact
   - **deploy:stg** or **deploy:prod** — `./scripts/eks.sh deploy <env> <tag>`

Production: the **deploy:prod** job sets `CONFIRM_PROD=prod` so `eks.sh` does not prompt in CI. Do not run prod deploy until staging is verified.

## Local equivalents

| CI job | Local command |
|--------|----------------|
| verify | `./scripts/check.sh` |
| build:images | `./scripts/eks.sh build [tag]` |
| deploy:stg | `./scripts/eks.sh deploy stg <tag>` |
| deploy:prod | `CONFIRM_PROD=prod CI=true ./scripts/eks.sh deploy prod <tag>` |

Helper scripts under `scripts/ci/` are thin wrappers around `eks.sh` with `CI=true`.

## Troubleshooting

- **Build fails on `check_account`** — wrong AWS account or expired credentials in CI variables.
- **kubectl auth errors** — runner must reach EKS; same `aws eks update-kubeconfig` as `eks.sh preflight`.
- **Empty `IMAGE_TAG` on deploy** — run **build:images** first, or set the **image_tag** pipeline input before build.
- **Prod deploy blocked** — use the `deploy:prod` job (not `deploy:stg`) and `deploy_env=prod`.