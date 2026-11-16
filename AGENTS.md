# AGENTS.md — project memory for Checkpoint

A brief for any AI (or person) picking up this project. Written 2026-11-10. The deep documentation is in `docs/` — this file points at it and adds the state that lives nowhere else.

- **What this is:** Checkpoint — an internal change-approval (CCB) tool for the Lenskart devx team. People file change requests, pick approvers, and everyone approves/rejects from the app or email. Google sign-in, `lenskart.com` / `lenskart.in` accounts only.
- **Read first:** `docs/ARCHITECTURE.md` (how it all works, file by file), `docs/EKS.md` (production on AWS), `docs/GUIDE.md` (run it on minikube).
- **Repo layout:** `backend/` (Express API + rules + email worker + Prisma), `frontend/` (Next.js 14.2 screens only), `deploy/k8s/` (minikube manifests), `deploy/helm/checkpoint/` (EKS chart), `deploy/karpenter/` (node pool), `scripts/` (minikube.sh, eks.sh, check.sh), `docs/`.

## Commands

```bash
npm run install:all          # installs backend + frontend (root package.json orchestrates)
npm run typecheck            # backend + frontend tsc
./scripts/check.sh           # FULL local check in throwaway Docker containers, no cluster needed:
                             #   backend types + migrations-vs-schema + seed + e2e smoke test on MySQL 8.4,
                             #   frontend types + build, helm lint + render. Run this before handing anything over.
./scripts/minikube.sh up     # whole app on minikube, namespace "checkpoint"
./scripts/minikube.sh open   # port-forward, then http://localhost:3000 (Mailpit UI on 8025)
./scripts/eks.sh help        # all EKS ops (build, deploy, rollback, status, logs, sql, backups...)
./scripts/eks.sh deploy stg <tag>   # deploy staging; anything touching devx-prod makes you type "prod"
```

- No test framework. The backend "test" is `backend/test/smoke.ts`, an end-to-end run executed by `check.sh` inside Docker.
- Node >= 20, TypeScript everywhere, plain npm (no pnpm/yarn workspaces — root package.json just delegates with `--prefix`).
- Schema changes: `npm --prefix backend run db:new-migration` (create-only), then commit the SQL. Never `prisma db push`. `check.sh` fails if schema and migrations drift apart.

## Architecture invariants (do not break these)

1. **Frontend never touches the database or secrets.** It only draws screens and forwards every `/api/...` request to the backend (`frontend/src/app/api/[...path]/route.ts`). `BACKEND_URL` is its only setting.
2. **`backend/src/config.ts` is the only file that reads `process.env`.**
3. **Email goes through the database** (`Outbox` table). Backend enqueues; the worker claims rows atomically (`SELECT ... FOR UPDATE SKIP LOCKED` — safe with multiple workers) and retries after 1/5/30/120/720 minutes, then marks FAILED. Local mail server is Mailpit; production is SES via plain SMTP settings (SES path **never tested**).
4. **Status is never stored** — always computed in `backend/src/status.ts` (any rejection → Rejected; all approved → Cleared).
5. **The approval matrix lives in the DB** (table `Setting`, id `approvers`), re-read every 10s. `deploy/k8s/approvers.yaml` is only the first-boot seed copy; admins edit it in the UI. `approvers-export`/`approvers-reset` in the scripts sync file ↔ DB.
6. **RBAC:** member / power user / admin on `User.access`, checked from the DB on every request. Admins edit the matrix and access; can't demote themselves; always ≥1 admin. First admin bootstrap: `dhruv.sharma@lenskart.com` (`BOOTSTRAP_ADMINS`, `deploy/k8s/users.yaml`).
7. **Only `general` CCB type is filable** (`ENABLED_CCB_TYPES` in the configmap; `all` or a CSV to widen). The catalog has 21 types in `backend/src/templates.ts` — adding a type = add an entry + re-seed, no other code.
8. **MySQL datadir lives in `/var/lib/mysql/data`** (an initContainer creates it and chowns 999:999), because a fresh EBS volume's root holds `lost+found` and MySQL refuses a non-empty datadir. Keep this if you touch the MySQL manifests.
9. Every mutating action in the UI is behind a confirm dialog (cancel is focused). Email approve/reject buttons open the page to confirm — never a one-click decision from a link.
10. Server inventory dropdowns (Database CCBs) read `deploy/k8s/mysql-inventory.yaml` and `mongodb-inventory.yaml` — read-only to the app, updated by editing the file and re-applying.

## Production target (EKS)

Cluster `lk-tech-infra-02-eks`, AWS account `964059510816`, region `ap-south-1`, namespaces `devx-stg` and `devx-prod`. `scripts/eks.sh` passes context on every call so the local kubectl context doesn't matter. Karpenter NodePool `devx` (`deploy/karpenter/devx-nodepool.yaml`): on-demand only, tainted `workload=devx:NoSchedule`, amd64, fixed instance-type list, MySQL pod annotated `karpenter.sh/do-not-disrupt`. Images go to ECR (`eks.sh build`; the Karpenter pool is amd64-only so build for amd64 at minimum). Backups: `mysqldump` CronJob to S3 (stg daily, prod every 6h) + AWS Backup on the EBS volume via the `backup=checkpoint-mysql` tag.

## Work in progress (uncommitted, as of 2026-11-10)

Everything below is modified in the working tree, **not yet committed** — review before committing:

- `deploy/k8s/mysql.yaml` + `deploy/helm/checkpoint/templates/mysql.yaml`: the datadir initContainer fix (invariant 8).
- `deploy/karpenter/devx-nodepool.yaml`: filled in the real node role/subnet/SG tags (copied from the cluster's `default` EC2NodeClass — role `lk-tech-infra-02-eks-node-role`), added the taint, `do-not-disrupt` notes, instance-type allowlist, 50Gi root volume, cost tags (`team: devx`, `app: checkpoint`).
- `deploy/helm/checkpoint/values-stg.yaml` / `values-prod.yaml`: nodeSelector + tolerations pinning to the devx pool.
- `scripts/eks.sh preflight`: made every check report instead of failing on missing objects.
- `scripts/minikube.sh`: fixed the shebang (two stray `aws` lines had been pasted above it) and `reset` now deletes the retained PVs too (old database files otherwise rebind on next `up`).
- `deploy/k8s/users.yaml`: removed an accidental paste of an `aws ec2 describe-volumes` command.

Git state: branch `main`, one commit ("first commit"), everything since is uncommitted.

## Known gaps / next steps (from the docs' own hand-over notes)

- ACM certificate still needed for the EKS ingress hosts; metrics-server and AWS Load Balancer Controller presence to confirm (`eks.sh preflight`).
- Real Google OAuth and SES have never been exercised end-to-end by the author — test before trusting them.
- **Staging signs in with a developer button until Google OAuth exists**: `values-stg.yaml` has `app.env: local` + `devLogin: "true"`; remove both when the client is ready. The chart fails to render `app.env: local` in a namespace containing "prod".
- Secrets are still plain Kubernetes Secrets (docs say: use Vault eventually). Rate limiting is per-pod, in memory.
- The frontend needs `next build` run before it's trusted on EKS; `check.sh` covers it — keep it in the loop.
- Frontend is Next.js 14.2 (App Router, pages under `frontend/src/app/(app)/`). There are Next.js-related skills vendored in `.agents/skills/` (see `skills-lock.json`, source `vercel/next.js`) — load the relevant one before doing Next.js work.

## House style (match it)

- Docs and comments are plain, short sentences explaining *why*, not *what*. YAML/TS files carry substantial comments; keep that density.
- One place per concern: routes in `routes.ts`, rules in `ccb.ts`, env in `config.ts`, emails in `mail.templates.ts`.
- Confirmation before any destructive or outward-facing action, in the app and in the scripts (`minikube.sh reset` asks you to type `yes`; prod deploys ask for `prod`).
