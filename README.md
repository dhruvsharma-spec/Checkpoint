# Checkpoint

One place to track every launch. CCB approvals, a release calendar and release meetings, with Google sign-in.

- **Run it on minikube:** [docs/GUIDE.md](docs/GUIDE.md)
- **How it is built, with diagrams:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

```bash
./scripts/minikube.sh up      # first run takes 5 to 10 minutes
./scripts/minikube.sh open    # then visit http://localhost:3000
```

Two services in two pods: [`frontend/`](frontend) (Next.js, screens only) and [`backend/`](backend) (Express API, rules, email worker), with MySQL 8.4 on a persistent volume and Mailpit for local email. Prisma talks to the database.
