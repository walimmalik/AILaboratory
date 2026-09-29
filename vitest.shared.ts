import { defineConfig } from 'vitest/config';

/** Resolve workspace packages to their TypeScript source in tests (the "source" export condition). */
const conditions = ['source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
