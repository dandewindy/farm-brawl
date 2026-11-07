import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./shared/src'),
    },
  },
  test: {
    include: ['client/test/**/*.test.ts', 'shared/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
