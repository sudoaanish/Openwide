import { build } from 'vite';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });
await cp(path.join(root, 'public'), out, { recursive: true });
for (const name of ['content', 'background', 'popup']) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      target: 'chrome116',
      outDir: out,
      emptyOutDir: false,
      minify: false,
      sourcemap: true,
      lib: {
        entry: path.join(root, 'src', name + '.ts'),
        name: 'Ultrawide' + name,
        formats: ['iife'],
        fileName: () => name + '.js',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    target: 'chrome116',
    outDir: path.join(root, 'demo'),
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.join(root, 'demo/fixture.ts'),
      name: 'UltrawideDemo',
      formats: ['iife'],
      fileName: () => 'standalone.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const demoHtml = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(
  path.join(root, 'demo/standalone.html'),
  demoHtml.replace('type="module" src="/demo/fixture.ts"', 'src="./standalone.js"')
);
console.log('Load unpacked extension: ' + out);
