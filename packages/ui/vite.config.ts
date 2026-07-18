import { defineConfig, searchForWorkspaceRoot, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'path';
// Shared singletons resolved at RUNTIME via the import-map (see vendor/build-vendor.mjs).
// The host must NOT bundle these — it leaves the bare specifiers so the browser
// resolves them to the SAME vendor modules the runtime-loaded plugins use (one
// React, one ReactDOM, one RouterContext, one host-services singleton). The list is
// the single source of truth in vendor/shared-externals.mjs (kept in sync with the
// vendor entries + import-map by tests/vendor-externals.test.ts).
import { SHARED_EXTERNALS } from './vendor/shared-externals.mjs';

// Inline the generated import-map into index.html BEFORE the module script.
// External import maps (<script type="importmap" src=...>) are NOT supported by
// any browser, so the map must be inline. Reads public/import-map.json (produced
// by build:vendor, which runs first) and replaces the placeholder tag.
function inlineImportMap(isBuild: boolean): Plugin {
  return {
    name: 'digita-inline-import-map',
    transformIndexHtml(html) {
      // Dev: runtime plugin federation is a production-only feature (it's served +
      // tested over the deployed nginx). Inlining the import-map AND excluding the
      // shared React specifiers from Vite's dep-optimizer makes pre-bundled deps
      // (e.g. react-query) import a stubbed react/jsx-runtime → "does not provide
      // an export named 'jsx'". So in dev we strip the import-map tag and let Vite
      // resolve React itself as a single instance; the host core surfaces (which
      // are what's iterated on locally) live in the host bundle and don't need it.
      if (!isBuild) {
        return html.replace(/<script type="importmap"[^>]*><\/script>/, '');
      }
      const mapPath = path.resolve(__dirname, 'public/import-map.json');
      let map: string;
      try {
        map = readFileSync(mapPath, 'utf-8').trim();
      } catch {
        throw new Error(
          `[inline-import-map] ${mapPath} not found — run build:vendor before the frontend build (build:assets does this).`,
        );
      }
      return html.replace(
        /<script type="importmap"[^>]*><\/script>/,
        `<script type="importmap">${map}</script>`,
      );
    },
    // After the HTML is written, emit the CSP sha256 of the FINAL inlined import
    // map so the image build can pin it in the nginx CSP `script-src` (replacing
    // 'unsafe-inline'). Hashing dist/index.html (not the source) guarantees the
    // digest matches byte-for-byte what the browser sees. Also ASSERTS the import
    // map is the ONLY inline script — a future inline script (e.g. a re-enabled
    // modulepreload polyfill) then fails the build loudly instead of being blocked
    // at runtime by the hashed CSP.
    closeBundle() {
      const htmlPath = path.resolve(__dirname, 'dist/index.html');
      const html = readFileSync(htmlPath, 'utf-8');
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
      const importmap = inline.find((m) => /type="importmap"/.test(m[0]));
      if (!importmap || inline.length !== 1) {
        throw new Error(
          `[inline-import-map] CSP invariant broken: expected exactly ONE inline script ` +
            `(the import map), found ${inline.length}. Add its sha256 to the nginx CSP or remove it.`,
        );
      }
      const hash = 'sha256-' + createHash('sha256').update(importmap[1], 'utf-8').digest('base64');
      writeFileSync(path.resolve(__dirname, 'dist/csp-importmap-sha256.txt'), hash + '\n');
    },
  };
}

// Point the dev server at a REMOTE backend (e.g. the erp.dev cluster) so the UI
// can be iterated on WITHOUT running the whole local stack. `pnpm dev:ui` stays
// local (engine :3000 + auth :3100); `pnpm dev:ui:remote` (= `vite --mode
// remote`) — or any `UI_BACKEND=<url>` — proxies EVERYTHING to that one origin,
// and the remote ingress performs the /api/v1/auth→IdP, /api→engine split itself,
// exactly like prod. UI_BACKEND wins over --mode so you can target any cluster.
const REMOTE_DEFAULT = 'https://erp.dev.digitaplatform.com';

export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build';
  const remoteBackend = process.env.UI_BACKEND || (mode === 'remote' ? REMOTE_DEFAULT : '');

  // Proxying http://localhost → a remote HTTPS origin needs three fixes for the
  // httpOnly-cookie session to survive: (1) rewrite Set-Cookie Domain to host-only
  // so the browser actually stores the session + readable CSRF cookies under
  // localhost; (2) spoof the Origin header to the target so the backend's
  // CSRF/Origin check sees a same-origin request; (3) secure:false so the proxy
  // tolerates the upstream cert. Empty for the local stack (same-origin already).
  const remoteOpts: Partial<ProxyOptions> = remoteBackend
    ? {
        secure: false,
        cookieDomainRewrite: { '*': '' },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', remoteBackend);
          });
          // Strip the upstream HSTS header so the browser can never force-upgrade
          // http://localhost to https (browsers normally ignore HSTS for
          // localhost, but this removes any doubt and keeps the dev server usable).
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['strict-transport-security'];
          });
        },
      }
    : {};

  const authTarget = remoteBackend || 'http://localhost:3100';
  const apiTarget = remoteBackend || 'http://localhost:3000';

  return {
    plugins: [react(), inlineImportMap(isBuild)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      // Dev loads plugin implementations from workspace SOURCE (see
      // registry.tsx) — dedupe the shared singletons so each plugin's own
      // node_modules copy collapses to the host's single instance (otherwise
      // hooks/context/portals break across the host↔plugin boundary).
      dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', '@digitaplatform/plugins'],
    },
    // Only the production BUILD externalizes the shared React/router specifiers
    // (resolved by the inlined import-map at runtime for plugin federation). In
    // dev we let Vite pre-bundle them normally as one instance — excluding them
    // here breaks pre-bundled deps that import react/jsx-runtime. See the
    // import-map plugin note above.
    ...(isBuild ? { optimizeDeps: { exclude: SHARED_EXTERNALS } } : {}),
    server: {
      port: 5174,
      // Allow the dev server to serve PREMIUM plugin source from the sibling repo
      // (digita-plugins-store/*) — needed for the dev plugin-source glob in
      // registry.tsx. First-party FREE plugins are built-in workspace packages
      // (packages/plugins/*) and are covered by the workspace root.
      fs: {
        allow: [
          searchForWorkspaceRoot(process.cwd()),
          path.resolve(__dirname, '../../../digita-plugins-store'),
        ],
      },
      // Path-based routing mirrors the prod ingress (per-app single origin):
      // auth flows go to the digita-auth IdP, everything else to the engine.
      // First match wins, so /api/v1/auth must precede /api. httpOnly session
      // cookies stay first-party because both targets share this origin.
      proxy: {
        '/api/v1/auth': {
          target: authTarget,
          changeOrigin: true,
          ...remoteOpts,
        },
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          ...remoteOpts,
        },
        // Live-sync WebSocket → the engine. `ws:true` upgrades the connection;
        // the httpOnly session cookie rides the handshake (same first-party origin).
        '/ws': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          ...remoteOpts,
        },
        '/health': {
          target: apiTarget,
          changeOrigin: true,
          ...remoteOpts,
        },
      },
    },
    build: {
      outDir: 'dist',
      // No inline modulepreload polyfill — it would be a second inline <script> that
      // the hashed CSP (script-src) would block. Browsers that support import maps
      // (required by this app) support modulepreload natively, so the polyfill is moot.
      modulePreload: { polyfill: false },
      rollupOptions: {
        // Keep shared specifiers as bare imports in the output → resolved by the
        // import-map at runtime (NOT bundled). This is what makes host + plugins
        // share one instance of each.
        external: SHARED_EXTERNALS,
        output: {
          // Split the (previously ~890KB) main chunk along library seams.
          // recharts/d3 keep their OWN chunk so the existing lazy import still
          // defers them; the rest groups by concern (icons/data/forms/vendor).
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('@tanstack')) return 'data';
            if (id.includes('zod') || id.includes('hookform')) return 'forms';
            return 'vendor';
          },
        },
      },
    },
  };
});
