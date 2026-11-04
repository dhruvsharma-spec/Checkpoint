# One image runs both the API and the background worker (different command).
#   docker build -t checkpoint-backend:local backend/
FROM node:20-bookworm-slim AS base
# openssl is needed by the Prisma tooling that creates the tables at start-up
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
# Placeholder URL: prisma generate only needs the variable to exist, it never connects.
ENV DATABASE_URL=mysql://build:build@localhost:3306/build
RUN npx prisma generate

FROM base AS run
ENV NODE_ENV=production HOME=/tmp
COPY --from=build /app ./
USER node
EXPOSE 4000
# API:     npm start                      (this default)
# Worker:  npx tsx worker/index.ts        (set in the Kubernetes worker Deployment)
CMD ["npm", "start"]
