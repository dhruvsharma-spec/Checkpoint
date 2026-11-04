# Run Checkpoint on minikube

This guide gets the whole system running on your Mac and walks you through trying it. For how the code works, read [ARCHITECTURE.md](ARCHITECTURE.md).

What you will have running:

| Piece | Name in the cluster |
|---|---|
| The screens (Next.js) | `checkpoint-frontend` |
| The API and all the rules | `checkpoint-backend` |
| Background email sender | `checkpoint-worker` |
| MySQL 8.4, as its own service, on a volume | `checkpoint-db` |
| Mail catcher, a stand-in for SES | `checkpoint-mail` |

## 1. Install the tools

You need a container engine, minikube and kubectl.

**If Homebrew is slow on your macOS version** (it compiles everything from source on macOS 14), skip it and download the ready-made programs instead. If `curl` returns an HTML error page ("Bad Gateway"), a company proxy is blocking the host: use the alternatives in the troubleshooting table.

```bash
mkdir -p ~/bin && echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

# minikube (Apple Silicon). Use minikube-darwin-amd64 on an Intel Mac.
curl -fSL --retry 3 -o ~/bin/minikube https://storage.googleapis.com/minikube/releases/latest/minikube-darwin-arm64
chmod +x ~/bin/minikube

# kubectl
V=$(curl -fsSL https://dl.k8s.io/release/stable.txt)
curl -fSL --retry 3 -o ~/bin/kubectl "https://dl.k8s.io/release/$V/bin/darwin/arm64/kubectl"
chmod +x ~/bin/kubectl
```

A container engine: install **Docker Desktop** from docker.com (or `brew install --cask docker`). Open it once, and in its settings give it at least **4 CPUs and 6 GB of memory**. The Docker daemon must be running before the next steps.

Check:

```bash
minikube version
kubectl version --client
docker version                        # must show a Client and a Server section
```

## 2. Set your admin email

Open `deploy/k8s/configmap.yaml` and set `BOOTSTRAP_ADMINS` to your own work email. Whoever signs in with that address becomes an admin.

## 3. Start everything

```bash
./scripts/minikube.sh up
```

In order: it starts minikube, points Docker at the Docker inside minikube (so images need no registry), builds the two images (`backend/` and `frontend/`), applies `deploy/k8s`, and waits for each piece. **The first run takes 5 to 10 minutes.**

The folders have no lock files for the new split yet, so the image builds run `npm install`. Run `npm run install:all` once on your machine if you want the lock files created and committed.

## 4. Open it

```bash
./scripts/minikube.sh open
```

Leave that terminal running.

| Address | What |
|---|---|
| http://localhost:3000 | Checkpoint (the frontend) |
| http://localhost:4000/api/health | The backend directly, for debugging |
| http://localhost:8025 | Mail viewer: every email the app sends appears here |

Sign-in is Google only. Until Google is set up (section 7), use the **Dhruv** button under **Local development only** on the sign-in page to sign in as the first admin (`dhruv.sharma@lenskart.com`). That button appears only while `APP_ENV` is `local`.

## 5. Try the main flow

1. Signing in lands on **CCB**: the list of every change. The sidebar has the **CCB** section, with **Calendar** and **Approval matrix** under it. **Access Management** and your own details are reachable from the top right and the bottom of the sidebar. There is no separate home page.
2. **CCB** already holds 13 sample CCBs, in every status and across Production, Preprod and Staging. Use the **Type** and **Status** drop-downs to filter. Delete the samples whenever you like.
3. Open one that is waiting, for example "Add a composite index on order_items". The page lists every step as **Pending**, **Approved** or **Rejected**, with the names still waiting. Under **Your steps**, press **Approve…** and confirm. With the default test list you are on every step, so you can answer for each in turn.
4. In the mail viewer, the emails arrive a few seconds later (the worker sends them).
5. When every step has approved, the change is **Cleared**. Mark it **Rolled out** (or rolled back) from the CCB page.
6. **+ New CCB** is one page, filled top to bottom (only General can be filed for now, so it opens straight on the form; other kinds are switched off with `ENABLED_CCB_TYPES` in `deploy/k8s/configmap.yaml`):
   - Title, business unit (Lenskart (India/International), Owndays or Ajna Lens), the requestor email (filled in with yours; change it if you are filing for someone else), the schedule, environment (Production, Preprod, Staging or Alpha) and the **risk level**.
   - **Service belongs to**: pick the team and its approvers; **+ Add another team** asks another team too. Then **Security** and **QA sign-off**, **DevOps** and **DataOps executioners**, and last the **Platform Approvers** (Pratiti is always on it and cannot be removed; you can add more). **Other** under Team lets you type a team that is not listed, with one approver. Everyone picked is asked at the same time.
   - **Details**: description, JIRA or MR link, whether it was tested in a lower environment (and why not), the risk associated with the change, systems affected and rollback plan. For a database change, pick MySQL or MongoDB servers from the drop-downs, or type one. 
   - Press **Request approval** and confirm. Anything still missing is listed above the button.
7. In the mail viewer, open the email. It shows the steps with the person on each, the details and **Approve** / **Reject** buttons for that email's step. The button opens the change in Checkpoint to confirm.
8. Leaving the form with anything entered (Back, a swipe, a menu link) asks whether to discard it.

## 6. Your data

MySQL stores its data on a PersistentVolumeClaim (`data-checkpoint-db-0`). It survives pod restarts, re-deploys and `stop`. There are **no backups** in this local setup. Check the volume:

```bash
./scripts/minikube.sh status      # the PVC should show Bound
```

`./scripts/minikube.sh reset` deletes the namespace, and the volume with it.

## 7. Turn on real Google sign-in

1. In the Google Cloud Console choose a project, then **APIs & Services, OAuth consent screen** (for a company Workspace choose **Internal**).
2. **Credentials, Create credentials, OAuth client ID**, type **Web application**.
3. Under **Authorized redirect URIs** add exactly `http://localhost:3000/api/auth/google/callback`.
4. Then:

```bash
./scripts/minikube.sh google <client-id> <client-secret>
```

Sign out and click **Continue with Google** with a `@lenskart.com` or `@lenskart.in` account. Your email in `BOOTSTRAP_ADMINS` becomes an admin. Everyone else starts with read access: open **Access** to give people write or admin. To make someone an approver, add them to `deploy/k8s/approvers.yaml` and run `./scripts/minikube.sh apply`.

## 8. Everyday commands

```bash
./scripts/minikube.sh status               # pods, services, volumes
./scripts/minikube.sh logs backend         # frontend | backend | worker | db | mail
./scripts/minikube.sh sync-logs            # the table-creation step before the backend starts
./scripts/minikube.sh apply                # after editing deploy/k8s/users.yaml or any other deploy file
./scripts/minikube.sh rebuild              # after you change code (both services)
./scripts/minikube.sh rebuild frontend     # or just one: frontend | backend
./scripts/minikube.sh sql                  # MySQL prompt in the database
./scripts/minikube.sh stop                 # pause minikube, data is kept
./scripts/minikube.sh reset                # delete the app and its data
```

### Running the services on your machine instead (no Kubernetes)

You need Node 20 and MySQL 8. Then:

```bash
npm run install:all
cp backend/.env.example backend/.env && cp frontend/.env.example frontend/.env.local   # edit DATABASE_URL
npm --prefix backend run db:migrate && npm --prefix backend run db:seed
npm run dev:backend      # terminal 1, :4000
npm run dev:worker       # terminal 2
npm run dev:frontend     # terminal 3, :3000
npm test                 # smoke test against the backend
```

## Troubleshooting

**Check which cluster kubectl points at.** `kubectl config current-context` shows it. The script always uses minikube, whatever this says. But a command you type yourself uses the current one, so for those add `--context minikube` (for example `kubectl --context minikube -n checkpoint get pods`), or switch with `kubectl config use-context minikube`. If it shows a company cluster such as an EKS one, do not run anything that changes things there by hand.


| You see | Cause and fix |
|---|---|
| `curl` saved an HTML page ("Bad Gateway") instead of a program | A proxy is blocking that host. Download in the browser and `mv` the file to `~/bin`, try a phone hotspot, or ask IT to allow `storage.googleapis.com/minikube`, `github.com` releases and `dl.k8s.io`. |
| `Cannot connect to the Docker daemon` | Open Docker Desktop and wait until it says it is running. |
| `Missing tool: ...` | A step 1 tool is missing. |
| `aws: NoCredentials` or an `eks` address in an error | kubectl was pointed at an EKS cluster. Update the script (it now always uses minikube), and see the note at the top of this section. |
| `ErrImagePull` or `ImagePullBackOff` for `checkpoint-backend` or `checkpoint-frontend` | The image is not in minikube's Docker. Run `./scripts/minikube.sh rebuild`. |
| Backend pod stuck on `Init:1/2` or `Init:Error` | The table-creation step failed. Run `./scripts/minikube.sh sync-logs`. The first run downloads one Prisma tool, so it needs internet. |
| The page loads but every action says "The service is not reachable" | The backend is not ready or crashed. `./scripts/minikube.sh logs backend`. |
| Build killed or out of memory | Raise Docker's memory to 6 GB or more, then `minikube delete` and `up` again. |
| `bind: address already in use` | Something else uses 3000, 4000 or 8025. Stop it. |
| Google says `redirect_uri_mismatch` | The URI in Google Cloud must be exactly `http://localhost:3000/api/auth/google/callback`. |
| You can look but not file CCBs | You have read access. An admin changes it under **Access**. |
| An approval email arrived but the button says you are not listed | Only people listed with an email under **CCB, Approvers** can answer. Check the email you signed in with matches. |
| Emails do not appear | `./scripts/minikube.sh logs worker`. The worker retries on failure, so a short outage only delays them. |
| A step has nobody in it, so no email went out | The change's audit trail says "No owner is listed for … in approvers.yaml". Add an owner to `deploy/k8s/approvers.yaml` and run `./scripts/minikube.sh apply`. See **CCB, Approvers**. |
| Want a clean slate | `./scripts/minikube.sh reset`, then `up`. |
