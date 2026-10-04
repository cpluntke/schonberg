// Vitest config for the realistic synthetic-singer harness (qa/realism).
// Run: npx vitest run --config vitest.realism.config.ts            (before/after → docs/qa/realism-current.md)
//      REALISM_BASELINE=1 npx vitest run --config vitest.realism.config.ts qa/realism/run.test.ts
//                                                                   (baseline only → docs/qa/realism-baseline.md)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD__: JSON.stringify('realism') },
  test: {
    // jsdom only for DOMParser (MusicXML import); everything else is plain computation.
    environment: 'jsdom',
    include: ['qa/realism/**/*.test.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
    // The cmp-*.test.ts files write separate parts; global-setup.ts merges them at the end.
    fileParallelism: true,
    globalSetup: ['qa/realism/global-setup.ts'],
  },
});
