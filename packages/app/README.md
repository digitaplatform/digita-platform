# @digitaplatform/app

The staff app of the platform: a React single-page app built with Vite.

## Run it locally

Both commands need `TRANSLATIONS_DIR`, the folder `translations/digita-app` of a
digitaplatform/digita-translations checkout. The dev and preview servers send `/api/v1/auth` to the
IdP on `localhost:3100` and every other `/api` call to the engine on `localhost:3000`; set
`UI_BACKEND=<url>` to send them all to one remote stage instead.

Development server, from the repository root:

```sh
pnpm build
TRANSLATIONS_DIR=<translations>/digita-app pnpm --filter @digitaplatform/app dev
```

Production build, from the repository root:

```sh
pnpm build:app
TRANSLATIONS_DIR=<translations>/digita-app pnpm --filter @digitaplatform/app preview
```

`pnpm build:app` stages the plugin inventory (`/plugins/index.json`) the way the image build does,
with `node tools/plugin-mock/stage-plugins.mjs --registry`. It fetches the plugin packages pinned in
`plugins.lock.json` from GitHub Packages, so npm needs a token for `npm.pkg.github.com` in its
`.npmrc`. Without the inventory every page load logs a 404 for it.
