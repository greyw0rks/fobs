# FOBS web — a Next.js app inside a pnpm workspace.
#
# A Dockerfile rather than autodetection because the repo root also holds an
# Anchor (Rust) program, and Railway's builder detects that first and tries to
# compile the wrong thing. This pins the build to the Node app.

FROM node:22-slim AS build
# Prisma needs OpenSSL at build and run time; the slim image ships without it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# NEXT_PUBLIC_* are inlined at build time, so they have to be present for
# `next build`. Railway passes service variables as build args.
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_USDC_MINT
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL \
    NEXT_PUBLIC_USDC_MINT=$NEXT_PUBLIC_USDC_MINT \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --dir apps/web prisma generate && pnpm --dir apps/web build

ENV NODE_ENV=production
EXPOSE 3000
# On start: bring the DB up to the schema, then serve. `--accept-data-loss` is
# required because this schema drops the retired demo columns (`walletSecret`,
# `isTestUser`, `isSeedTrader`) — a non-interactive `db push` aborts on a column
# drop without it. The markets catalogue is seeded in the background (idempotent
# upsert of the tradeable universe, priced from a live read) so the list is
# populated without delaying the server — a throttle or a bad read there must not
# block boot, hence `|| true`. `next start` binds the port Railway assigns.
CMD ["sh", "-c", "pnpm --dir apps/web prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss; ( pnpm --dir apps/web seed:markets || true ) & exec pnpm --dir apps/web start -p ${PORT:-3000}"]
