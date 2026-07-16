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
# PLUGIN DELIVERY: this image bakes ONLY the FREE staged plugin artifacts into
# the SPA web root. tools/plugin-mock/stage-plugins.mjs stages the set pinned in
# plugins.lock.json, splitting the two tiers by DESTINATION so premium bytes can
# never enter this image's web root:
#   packages/ui/public/plugins/<id>/<ver>/<entry> + /plugins/index.json
#                                       (free    — nginx-static, baked into this image)
#   <repoRoot>/staged-premium/<id>/<ver>/<entry>
#                                       (premium — OUTSIDE this build context;
#                                        mounted by the ENGINE image/chart)
# The host joins GET /api/v1/plugins (composition + entitlements) with
# /plugins/index.json (inventory) and loads each plugin by type (component →
# dynamic import, design → <link rel="stylesheet">). Premium bytes are NEVER
# served by nginx and NEVER ride in this image: the engine streams them at
# /api/v1/plugin-assets/... from PLUGINS_PREMIUM_DIR (engine env — owned by the
# engine image/chart, which points it at the staged-premium dir) after verifying
# the tenant's license entitlements. This ui image ALWAYS ships free-only.
#
# Registry auth: the build pipeline writes an authenticated .npmrc
# (@digitaplatform scope → GitHub Packages + read token) into the build-context
# root. It is BIND-MOUNTED into the deps install below — never COPY'd — so the
# token can never land in an image layer. The nginx stage copies artifacts
# only → no mount there.
# ──────────────────────────────────────────────────────────────

# ─── Stage 1: Install dependencies ───────────────────────────
FROM node:24-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app

ENV MONGOMS_DISABLE_POSTINSTALL=1

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY packages/components/package.json packages/components/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/plugins/usermenu/package.json packages/plugins/usermenu/
COPY packages/engine/package.json packages/engine/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/

# ui (host) + @digitaplatform/theme (design foundation) + @digitaplatform/components
# (React kit) + @digitaplatform/plugins (SDK) + @digitaplatform/usermenu (BUILT-IN
# first-party plugin — its source compiles into the host bundle) + shared — all
# in-repo workspace members. The host stays app-agnostic; it bundles NO apps.
# PREMIUM plugin bundles are built in digita-plugins and are NOT
# installed as deps — they enter as staged static artifacts (see PLUGIN
# DELIVERY above).
RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile \
    --filter @digitaplatform/shared \
    --filter @digitaplatform/theme \
    --filter @digitaplatform/components \
    --filter @digitaplatform/plugins \
    --filter @digitaplatform/usermenu \
    --filter @digitaplatform/ui

# ─── Stage 2: Build ──────────────────────────────────────────
FROM deps AS build

COPY packages/shared/ packages/shared/
COPY packages/theme/ packages/theme/
COPY packages/components/ packages/components/
COPY packages/plugins/ packages/plugins/
COPY packages/ui/ packages/ui/

# Staging inputs: the pinned plugin set + the staging script + the build guard.
COPY plugins.lock.json ./
COPY tools/plugin-mock/stage-plugins.mjs tools/plugin-mock/
COPY docker/verify-plugin-stage.mjs docker/

# ─── Stage the plugin artifacts (BEFORE the vite build) ──────
# vite copies public/ → dist/ verbatim, so the staged plugin tree (see PLUGIN
# DELIVERY above) must exist NOW. `stage-plugins.mjs --local` reads built
# dists from the SIBLING repo (digita-plugins) which lives OUTSIDE this build
# context, so it cannot run in here. Two supported paths:
#   PLUGINS_SOURCE=prestaged (default): staging already ran on the HOST
#     (`node tools/plugin-mock/stage-plugins.mjs --local`) and the FREE staged
#     tree (public/plugins/) entered via `COPY packages/ui/` above. Premium was
#     staged to <repoRoot>/staged-premium/ — OUTSIDE this build context — so it
#     is intentionally absent here (engine-mounted; see PLUGIN DELIVERY). Both
#     staged trees are GITIGNORED — a fresh clone must run staging before build.
#   PLUGINS_SOURCE=registry: stage inside the build via `npm pack` from the
#     registry (--registry mode; auth via the bind-mounted .npmrc). Premium lands
#     in /app/staged-premium and is likewise ignored by this free-only image.
# Either way the FREE staged tree is then verified against the inventory (files
# exist, sha384 integrity matches, free/premium URL shapes correct, and NO
# premium bytes in the web root) so a broken/partial stage fails the build here,
# not at runtime.
# WITH_PLUGINS=0 (emergency escape hatch, also honoured by the deploy guard
# below) skips staging entirely and ships a plugin-less image.
ARG WITH_PLUGINS=1
ARG PLUGINS_SOURCE=prestaged
RUN --mount=type=bind,source=.npmrc,target=/root/.npmrc \
    set -eu; \
    if [ "$WITH_PLUGINS" != "1" ]; then \
      echo "WITH_PLUGINS=0: skipping plugin staging (emergency escape hatch)"; \
      exit 0; \
    fi; \
    if [ "$PLUGINS_SOURCE" = "registry" ]; then \
      node tools/plugin-mock/stage-plugins.mjs --registry; \
    elif [ "$PLUGINS_SOURCE" != "prestaged" ]; then \
      echo "ERROR: PLUGINS_SOURCE must be 'prestaged' or 'registry' (got '$PLUGINS_SOURCE')"; exit 1; \
    elif [ ! -s packages/ui/public/plugins/index.json ]; then \
      echo "ERROR: packages/ui/public/plugins/index.json missing from the build context."; \
      echo "  Run 'node tools/plugin-mock/stage-plugins.mjs --local' before 'docker build',"; \
      echo "  or build with --build-arg PLUGINS_SOURCE=registry (published packages + .npmrc)."; \
      exit 1; \
    fi; \
    node docker/verify-plugin-stage.mjs --staged --require-no-premium

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
#  - WITH_PLUGINS=1 (default): dist/plugins/index.json — the inventory the host
#    joins against GET /api/v1/plugins — made it into dist/, and EVERY free
#    artifact it lists exists with a matching sha384 integrity. This ui image is
#    ALWAYS free-only: dist/plugins-premium is stripped (a no-op — premium was
#    staged to <repoRoot>/staged-premium, OUTSIDE this build context) and the
#    ABSENCE of premium bytes is asserted (verify-plugin-stage.mjs --dist
#    --require-no-premium). Premium CSS/JS reaches the browser ONLY via the
#    engine's gated /api/v1/plugin-assets/... route (streamed from
#    PLUGINS_PREMIUM_DIR — an ENGINE env owned by the engine image/chart; it
#    points at the staged-premium dir). WITH_PLUGINS=0 is the emergency escape
#    hatch: ship a plugin-less image (both plugin dirs stripped).
#  - no browser-breaking shims leaked into the host or plugin bundles (a throwing
#    dynamic-require or unreplaced process.env/jsxDEV = a deploy-only white screen).
# (WITH_PLUGINS is declared before the staging step above and stays in scope.)
RUN set -eu; \
    grep -q '<script type="importmap">' packages/ui/dist/index.html \
      || { echo "ERROR: import-map not inlined into dist/index.html"; exit 1; }; \
    ! grep -q 'type="importmap" src=' packages/ui/dist/index.html \
      || { echo "ERROR: dist/index.html still has a non-working external import map"; exit 1; }; \
    [ -n "$(ls -A packages/ui/dist/vendor 2>/dev/null)" ] \
      || { echo "ERROR: dist/vendor is empty"; exit 1; }; \
    if [ "$WITH_PLUGINS" = "1" ]; then \
      test -s packages/ui/dist/plugins/index.json \
        || { echo "ERROR: dist/plugins/index.json (plugin inventory) missing — staging did not reach dist/"; exit 1; }; \
      rm -rf packages/ui/dist/plugins-premium; \
      node docker/verify-plugin-stage.mjs --dist --require-no-premium; \
    else \
      echo "WITH_PLUGINS=0: shipping a plugin-less image (emergency escape hatch)"; \
      rm -rf packages/ui/dist/plugins packages/ui/dist/plugins-premium; \
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
