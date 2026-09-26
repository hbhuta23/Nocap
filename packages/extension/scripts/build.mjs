// Bundles the extension AND the daemon into dist/, and copies shims + hooks next to them,
// so the .vsix is self-contained (A6).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'info' };

const contexts = await Promise.all([
  esbuild.context({ ...common, entryPoints: [join(root, 'src/extension.ts')], outfile: join(root, 'dist/extension.js'), external: ['vscode'] }),
  esbuild.context({ ...common, entryPoints: [join(root, '../daemon/src/server.ts')], outfile: join(root, 'dist/daemon.js') }),
]);

mkdirSync(join(root, 'dist/shims'), { recursive: true });
cpSync(join(root, '../shims/bin'), join(root, 'dist/shims/bin'), { recursive: true });
cpSync(join(root, '../shims/hooks'), join(root, 'dist/shims/hooks'), { recursive: true });

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
