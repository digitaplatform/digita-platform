# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Digita Platform — Public Website (packages/web, Next.js SSR :3001)
# Multi-stage build: deps → build → production (non-root "digita")
# Build context is the digita-platform REPO ROOT (the repo carries its own docker/):
#   docker build -f docker/web.Dockerfile -t digita-web .
#
# A Node runtime — NOT nginx static (output:"standalone"). ISR / on-demand
# revalidation / dynamic OG / draft mode all need a server. The renderer fetches
# the engine's GENERIC public read API server-side (cluster-internal ENGINE_URL);
# browser-loaded media is served same-origin via the web host ingress
# (/api/v1/public → engine). See the digita-deploy digita-web chart.
#
# packages/web/next.config.mjs sets outputFileTracingRoot to the REPO ROOT
# (two levels up from packages/web = /app here), so the standalone bundle pulls
# in the workspace deps (@digitaplatform/theme, @digitaplatform/shared) and the
# pnpm-symlinked node_modules.
#
# Registry auth: the build pipeline writes an authenticated .npmrc
# (@digitaplatform scope → GitHub Packages + read token) into the build-context
# root. It is BIND-MOUNTED into the deps install below — never COPY'd — so the
# token can never land in an image layer. The production stage copies build
# artifacts only → no mount there.
# ──────────────────────────────────────────────────────────────

# ─── Stage 1: Install dependencies ───────────────────────────
FROM node:24-alpine AS deps

# Pin pnpm to the major the lockfile was written with (lockfileVersion 9.0).
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app

# mongodb-memory-server (a sibling devDep in the workspace) would download a
# mongod binary in its postinstall — pointless inside this image.
ENV MONGOMS_DISABLE_POSTINSTALL=1

# Copy workspace config + EVERY workspace member package.json (pnpm validates
# the frozen lockfile against the whole workspace), then filter the install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY packages/components/package.json packages/components/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/

# web (Next.js host) + @digitaplatform/theme (design foundation, provides the
# imported theme.css) + shared. devDeps included (tailwind/postcss/tsc needed by
# `next build`).
RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile \
    --filter @digitaplatform/shared \
    --filter @digitaplatform/theme \
    --filter @digitaplatform/web

# ─── Stage 2: Build ──────────────────────────────────────────
FROM deps AS build

COPY packages/shared/ packages/shared/
COPY packages/theme/ packages/theme/
COPY packages/web/ packages/web/

# theme MUST be built before the host (web imports @digitaplatform/theme/theme.css
# = dist/theme.css). The engine is unreachable at build time → the engine-client
# returns [] and pages prerender gracefully (ISR fills real content at runtime).
RUN pnpm --filter @digitaplatform/shared build && \
    pnpm --filter @digitaplatform/theme build && \
    pnpm --filter @digitaplatform/web build

# ─── Stage 3: Production image ──────────────────────────────
FROM node:24-alpine AS production

RUN addgroup -S digita && adduser -S digita -G digita

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# Next standalone output (traced from the repo root via outputFileTracingRoot):
# the server + its minimal node_modules + traced workspace packages. `static/`
# and the app live under packages/web/ inside the standalone tree.
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static

RUN chown -R digita:digita /app
USER digita

EXPOSE 3001

# /robots.txt is generated without touching the engine → a stable liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/robots.txt >/dev/null 2>&1 || exit 1

CMD ["node", "packages/web/server.js"]
