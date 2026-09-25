// Build the pre-paint identity boot: the entry src/runtime/identity-boot-script.ts,
// bundled with the runtime it calls into one classic script, and published as the
// string IDENTITY_BOOT_SCRIPT (entry `@digitaplatform/theme/identity-boot`), which a
// server-rendered page inlines in its <head>. It is the same bootIdentity the app
// runs, not a second copy of the logic. Runs after `tsc`.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await build({
  entryPoints: [join(root, 'src/runtime/identity-boot-script.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2019',
  legalComments: 'none',
  logLevel: 'warning',
  write: false,
});
const script = result.outputFiles[0].text.trim();

writeFileSync(join(root, 'dist/identity-boot.js'), `export const IDENTITY_BOOT_SCRIPT = ${JSON.stringify(script)};\n`);
writeFileSync(
  join(root, 'dist/identity-boot.d.ts'),
  `/** The pre-paint identity boot: a classic script a server-rendered page inlines in its <head>,
 *  after a <script type="application/json" id="digita-identity"> holding { signatures, branding }. */
export declare const IDENTITY_BOOT_SCRIPT: string;
`,
);
