// Standalone vitest config for QA specs (project config only includes src/**).
// Run from repo root: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: new URL('../../..', import.meta.url).pathname,
  test: { environment: 'jsdom', include: ['docs/qa/scripts/**/*.qa.test.ts'], testTimeout: 120000 },
});
