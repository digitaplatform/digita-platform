// Under `vite` dev the built-in plugins come from node_modules, so Vite pre-bundles them. The host
// provides its services to the plugin SDK module it imports; a plugin that reads them from another
// copy of the SDK finds none and throws on its first render. This runs the app's own dev config.
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
    server: { middlewareMode: true, hmr: false, ws: false },
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
  it('usermenu reads its host services from the SDK module the host provides them to', async () => {
    const provided = await importUrl('/src/plugins/host-services.ts', 'provideHostServices');
    const builtins = await server.transformRequest('/src/plugins/builtins.ts');
    const usermenu = builtins?.code.match(/from "([^"]*usermenu[^"]*)"/)?.[1];
    expect(usermenu).toBeDefined();

    expect(await importUrl(usermenu!, 'useHost')).toBe(provided);
  }, 120_000);
});
