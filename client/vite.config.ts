import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  publicDir: r('public'),
  resolve: { alias: { '@shared': r('../shared/src') } },
  server: { port: 5180, host: true },
  preview: { port: 5180, host: true },
  build: { outDir: r('../dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
