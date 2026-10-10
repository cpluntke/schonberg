import { describe, expect, it } from 'vitest';
import { keptTitle } from './library';

describe('a choir score keeps the title the singer has, unless it is only the file name', () => {
  it('keeps a real title, drops a file-name, empty or Untitled one', () => {
    expect(keptTitle('Dieu! qu’il la fait bon regarder!', 'debussy-dieu.mxl')).toBe(true);
    expect(keptTitle('debussy-dieu', 'debussy-dieu.mxl')).toBe(false);
    expect(keptTitle('Debussy-Dieu', 'scores/debussy-dieu.mxl')).toBe(false);
    expect(keptTitle('', 'x.mxl')).toBe(false);
    expect(keptTitle('Untitled', 'x.mxl')).toBe(false);
    expect(keptTitle(undefined, 'x.mxl')).toBe(false);
  });
});
