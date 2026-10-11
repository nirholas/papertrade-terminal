import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

const out = new URL('../site/public/', import.meta.url).pathname;

for (const glob of ['app.js', 'app.js.map']) await rm(`${out}${glob}`, { force: true });
await rm(`${out}chunks`, { recursive: true, force: true });

const result = await build({
  entryPoints: { app: 'src/app.ts' },
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  logLevel: 'info',
});

const sizes = Object.entries(result.metafile.outputs)
  .filter(([file]) => !file.endsWith('.map'))
  .map(([file, meta]) => `${file.replace(/^.*site\/public\//, '')} ${(meta.bytes / 1024).toFixed(1)} KiB`);
console.log(sizes.join('\n'));
