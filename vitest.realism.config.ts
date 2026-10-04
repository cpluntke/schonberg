// Vitest config for the realistic synthetic-singer harness (qa/realism).
// Run: npx vitest run --config vitest.realism.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD__: JSON.stringify('realism') },
  test: {
    // jsdom only for DOMParser (MusicXML import); everything else is plain computation.
    environment: 'jsdom',
    include: ['qa/realism/**/*.test.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
    // One file, one worker: the experiments are CPU-bound and write shared outputs.
    fileParallelism: false,
  },
});
