// The host provides its services to the plugin SDK module it imports under `vite` dev; a built-in
// plugin that reads them from another copy of the SDK, such as a pre-bundled one, finds none and
// throws on its first render. This runs the app's own dev config.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = mkdtempSync(join(tmpdir(), 'dev-plugin-sdk-'));
let server: ViteDevServer;

beforeAll(async () => {
  server = await createServer({
    configFile: join(appDir, 'vite.config.ts'),
    root: appDir,
    cacheDir,
    logLevel: 'error',
    // Vite merges this config into the app's file and skips a `watch: null` there, so every path is
    // ignored instead.
    server: { middlewareMode: true, hmr: false, ws: false, watch: { ignored: () => true } },
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
  rmSync(cacheDir, { recursive: true, force: true });
});

/** The URL a served module imports `name` from. */
async function importUrl(url: string, name: string): Promise<string> {
  const served = await server.transformRequest(url);
  const match = served?.code.match(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "([^"]+)"`));
  if (!match?.[1]) throw new Error(`${url} does not import ${name}`);
  return match[1];
}

describe('vite dev serves the plugin SDK once', () => {
  it('the app menu reads its host services from the SDK module the host provides them to', async () => {
    const provided = await importUrl('/src/plugins/host-services.ts', 'provideHostServices');
    expect(await importUrl('/src/plugins/app-menu/AppMenu.tsx', 'useHost')).toBe(provided);
  }, 120_000);

  // The server only transforms modules once and closes, so it needs no watcher. A watcher takes
  // inotify watches for the app and its dependencies, and where the machine's table is nearly
  // full, every watch it asks for fails the run with ENOSPC although each test passed.
  it('PLANTED DEFECT: watches no file', () => {
    expect(server.watcher.getWatched()).toEqual({});
  });
});
