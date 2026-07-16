# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Digita Platform — Engine (packages/engine, Fastify :3000)
# Multi-stage build: deps → build → production (non-root "digita")
# Build context is the digita-platform REPO ROOT (the repo carries its own docker/):
#   docker build -f docker/engine.Dockerfile -t digita-engine .
#
# The image ships ONLY the generic engine (dist/) — NO apps baked in. Apps live
# in the separate digita-apps repo and are delivered at runtime as a mounted
# app-bundle (initContainer → emptyDir → APPS_DIRS); the engine auto-discovers
# every app folder under APPS_DIRS (see env.ts). See the digita-deploy
# digita-engine chart for the mount wiring.
#
# Registry auth: the build pipeline writes an authenticated .npmrc
# (@digitaplatform scope → GitHub Packages + read token) into the build-context
# root. It is BIND-MOUNTED into each pnpm install below — never COPY'd — so the
# token can never land in an image layer.
# ──────────────────────────────────────────────────────────────

# ─── Stage 1: Install dependencies ───────────────────────────
FROM node:24-alpine AS deps

# Pin pnpm to the major the lockfile was written with (lockfileVersion 9.0).
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app

# mongodb-memory-server (devDep) would download a full mongod binary in its
# postinstall — pointless inside an image build.
ENV MONGOMS_DISABLE_POSTINSTALL=1

# Copy workspace config + EVERY workspace member package.json (pnpm validates
# the frozen lockfile against the whole workspace), then filter the install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY packages/components/package.json packages/components/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/plugins/usermenu/package.json packages/plugins/usermenu/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/

RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --filter @digitaplatform/shared --filter @digitaplatform/engine

# ─── Stage 2: Build ──────────────────────────────────────────
FROM deps AS build

COPY packages/shared/ packages/shared/
COPY packages/engine/ packages/engine/

# shared → engine (tsc + copy-assets: entity/locale .json + .cjs land in dist/).
# No apps are built here — they live in the digita-apps repo and ship as a
# separately-built app-bundle mounted at runtime under APPS_DIRS.
RUN pnpm --filter @digitaplatform/shared build && \
    pnpm --filter @digitaplatform/engine build

# ─── Stage 3: Production image ──────────────────────────────
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Security: run as non-root
RUN addgroup -S digita && adduser -S digita -G digita

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY packages/components/package.json packages/components/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/plugins/usermenu/package.json packages/plugins/usermenu/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/

# Production deps only (argon2 is allowed to run its build script via
# allowBuilds — it resolves a prebuilt musl binary, no compiler).
RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --prod --filter @digitaplatform/shared --filter @digitaplatform/engine

# Built output. engine dist/ already contains entities/, locales/, modules/
# (tsc + scripts/copy-assets.mjs) — do NOT re-copy from src/, that would put
# .ts hook files back in the image and the hook-loader prefers .ts over .js.
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/packages/engine/dist/ packages/engine/dist/

RUN mkdir -p /app/uploads && chown -R digita:digita /app

USER digita

# cwd = packages/engine/ so the compiled-runtime asset auto-detection
# (ENTITIES_DIR/MODULES_DIR/LOCALES_DIR default to ./dist/*) and the
# relative APP_DIRS resolve exactly like `pnpm start` does locally.
WORKDIR /app/packages/engine

# Default env vars (override at runtime). Required at runtime but NOT set here:
# MONGODB_URI, AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE. Apps are NOT baked in —
# the chart points APPS_DIRS at the mounted app-bundle so the engine
# auto-discovers every app; with no mount the engine runs app-less.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    LOG_PRETTY=false \
    LOG_LEVEL=info \
    UPLOAD_LOCAL_PATH=/app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
