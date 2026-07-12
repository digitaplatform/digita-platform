# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────
# Digita Platform — Operator Frontend (packages/ui, React SPA)
# Generic, app-agnostic UI — renders any engine app from metadata.
# Multi-stage build: deps → build → nginx static serving (:8080)
# Build context is the digita-platform REPO ROOT (the repo carries its own docker/):
#   docker build -f docker/ui.Dockerfile -t digita-ui .
#
# nginx serves the SPA + the plugin runtime (/vendor shared ESM, /plugins app
# plugin bundles, /import-map.json). API path routing happens at the INGRESS:
#   /api/v1/auth → digita-auth-backend :3100, /api + /health → engine :3000,
#   /            → this SPA
# (see the digita-deploy digita-ui chart ingress).
#
# PLUGIN HANDOFF: the usermenu plugin no longer lives in this repo — it moved
# to digita-plugins-community (@digitaplatform/plugin-usermenu). Until the
# phase-2 plugin-loader wiring lands, this image ships NO plugin bundles and
# the usermenu deploy-guard assertion is gated behind WITH_PLUGINS (default 0).
#
# Registry auth: the build pipeline writes an authenticated .npmrc
# (@digitaplatform scope → GitHub Packages + read token) into the build-context
# root. It is BIND-MOUNTED into the deps install below — never COPY'd — so the
# token can never land in an image layer. The nginx stage copies artifacts
# only → no mount there.
# ──────────────────────────────────────────────────────────────

# ─── Stage 1: Install dependencies ───────────────────────────
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app

ENV MONGOMS_DISABLE_POSTINSTALL=1

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY packages/components/package.json packages/components/
COPY packages/plugins/package.json packages/plugins/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/

# ui (host) + @digitaplatform/theme (design foundation) + @digitaplatform/components
# (React kit) + @digitaplatform/plugins (SDK) + shared — all in-repo workspace
# members. The host stays app-agnostic; it bundles NO apps. Plugin bundles
# (e.g. usermenu) are built in digita-plugins-community and are NOT installed
# here (see PLUGIN HANDOFF above).
RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile \
    --filter @digitaplatform/shared \
    --filter @digitaplatform/theme \
    --filter @digitaplatform/components \
    --filter @digitaplatform/plugins \
    --filter @digitaplatform/ui

# ─── Stage 2: Build ──────────────────────────────────────────
FROM deps AS build

COPY packages/shared/ packages/shared/
COPY packages/theme/ packages/theme/
COPY packages/components/ packages/components/
COPY packages/plugins/ packages/plugins/
COPY packages/ui/ packages/ui/

# TODO(phase2 plugin-loader): fetch the @digitaplatform/plugin-usermenu BUILT
# bundle (published from digita-plugins-community) into
# packages/ui/public/plugins/usermenu/ HERE — before build:vendor/vite build —
# so it lands in dist/plugins/ and the WITH_PLUGINS=1 guard below can become
# the default again. Until then the image ships without plugin bundles.

# Order matters: shared → theme (tsc + gen-css) → components (React kit) →
# plugins SDK (tsc) → build:vendor (vendor ESM singletons + import-map.json
# staged into packages/ui/public) → host build (vite copies public/ → dist/,
# inlines the import-map, imports @digitaplatform/theme/theme.css).
RUN pnpm --filter @digitaplatform/shared build && \
    pnpm --filter @digitaplatform/theme build && \
    pnpm --filter @digitaplatform/components build && \
    pnpm --filter @digitaplatform/plugins build && \
    pnpm --filter @digitaplatform/ui build:vendor && \
    pnpm --filter @digitaplatform/ui build

# Deploy guard: the plugin runtime MUST be in the image, or runtime plugin
# loading 404s / the SPA fails to boot only in prod. Assert the EXACT artifacts:
#  - the import-map is INLINED into index.html (external import maps don't work),
#  - the vendor ESM dir is populated,
#  - WITH_PLUGINS=1 only: the exact plugin bundle the engine advertises
#    (/plugins/usermenu/usermenu.js). Default 0 — the usermenu plugin now
#    builds in digita-plugins-community and is not staged here yet (see the
#    phase2 plugin-loader TODO above), so the assertion would always fail.
#  - no browser-breaking shims leaked into the host or plugin bundles (a throwing
#    dynamic-require or unreplaced process.env/jsxDEV = a deploy-only white screen).
ARG WITH_PLUGINS=0
RUN set -eu; \
    grep -q '<script type="importmap">' packages/ui/dist/index.html \
      || { echo "ERROR: import-map not inlined into dist/index.html"; exit 1; }; \
    ! grep -q 'type="importmap" src=' packages/ui/dist/index.html \
      || { echo "ERROR: dist/index.html still has a non-working external import map"; exit 1; }; \
    [ -n "$(ls -A packages/ui/dist/vendor 2>/dev/null)" ] \
      || { echo "ERROR: dist/vendor is empty"; exit 1; }; \
    if [ "$WITH_PLUGINS" = "1" ]; then \
      test -s packages/ui/dist/plugins/usermenu/usermenu.js \
        || { echo "ERROR: dist/plugins/usermenu/usermenu.js missing"; exit 1; }; \
    else \
      echo "WITH_PLUGINS=0: skipping usermenu bundle assertion (plugin moved to digita-plugins-community; TODO phase2 plugin-loader)"; \
    fi; \
    PLUGIN_DIR=""; \
    if [ -d packages/ui/dist/plugins ]; then PLUGIN_DIR="packages/ui/dist/plugins"; fi; \
    if grep -rEl 'Dynamic require of|Calling `require`' packages/ui/dist/assets packages/ui/dist/vendor $PLUGIN_DIR; then \
      echo "ERROR: throwing dynamic-require shim leaked into a shipped bundle (CJS dep + externalized react)"; exit 1; \
    fi; \
    if grep -rEl 'jsxDEV' packages/ui/dist/assets $PLUGIN_DIR; then \
      echo "ERROR: dev JSX runtime leaked into the host/plugin bundle (NODE_ENV not production in a lib build)"; exit 1; \
    fi

# ─── Stage 3: nginx static serving ──────────────────────────
FROM nginx:alpine AS production

# Operator-frontend nginx config (NOT the shared nginx-spa.conf the other SPA
# images use): adds the /vendor + /plugins locations + an enforced CSP.
# listen 8080, /tmp paths, SPA fallback, NO api proxying (the ingress owns
# path routing).
COPY docker/nginx-ui.conf /etc/nginx/nginx.conf
COPY --from=build /app/packages/ui/dist/ /usr/share/nginx/html/

# Pin the inline import-map's CSP sha256 (emitted by the vite build into
# dist/csp-importmap-sha256.txt) into the nginx CSP `script-src`, replacing the
# __IMPORTMAP_SHA256__ placeholder — so script-src needs NO 'unsafe-inline'. Fail
# the build if the hash is missing or the placeholder survives. Then drop the hash
# file from the served web root.
RUN HASH="$(cat /usr/share/nginx/html/csp-importmap-sha256.txt)"; \
    test -n "$HASH" || { echo "ERROR: csp-importmap-sha256.txt missing/empty"; exit 1; }; \
    sed -i "s|__IMPORTMAP_SHA256__|${HASH}|" /etc/nginx/nginx.conf; \
    ! grep -q '__IMPORTMAP_SHA256__' /etc/nginx/nginx.conf || { echo "ERROR: CSP placeholder not replaced"; exit 1; }; \
    rm /usr/share/nginx/html/csp-importmap-sha256.txt

# Non-root: the official image ships the `nginx` user; the config keeps
# every writable path under /tmp.
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
