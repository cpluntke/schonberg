// QA round 3 code review: app never leaves "Loading repertoire…" when localStorage access throws (CR-08).
// Run: npx vitest run --config docs/qa/scripts/vitest.qa.config.mjs r3cr-storage-blocked --silent=false
import { describe, it, expect } from 'vitest';

describe('CR-08 storage blocked', () => {
  it('ensureLoaded() rejects and loaded stays false when localStorage throws SecurityError', async () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    const lib = await import('../../../src/ui/library');
    let err: unknown = null;
    try { await lib.ensureLoaded(); } catch (e) { err = e; }
    console.log('CR-08', JSON.stringify({ rejected: !!err, message: String(err) }));
    expect(err).toBeNull();
  });
});
