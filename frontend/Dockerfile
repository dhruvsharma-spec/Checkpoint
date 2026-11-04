# The frontend: the screens only. It forwards every /api request to the backend service.
#   docker build -t checkpoint-frontend:local frontend/
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
USER node
EXPOSE 3000
# BACKEND_URL is read when the server starts (not at build time), so the same image runs anywhere.
CMD ["npm", "start"]
