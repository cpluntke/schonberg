import { describe, it, expect } from 'vitest';
import { ALPHABET, decodeRestoreCode, encodeRestoreCode, isBackupKey, KEY_LEN, newBackupKey, normaliseCode } from './backupCode';

describe('backup key and restore code', () => {
  it('makes 26-character keys from the Crockford alphabet (130 bits)', () => {
    const k = newBackupKey();
    expect(k).toHaveLength(KEY_LEN);
    expect(isBackupKey(k)).toBe(true);
    expect(KEY_LEN * Math.log2(ALPHABET.length)).toBeGreaterThanOrEqual(128);
    expect(new Set(Array.from({ length: 50 }, () => newBackupKey())).size).toBe(50);
    expect([...ALPHABET].some((c) => 'ILOU'.includes(c))).toBe(false);
  });

  it('round-trips through 7 groups of 4', () => {
    for (let i = 0; i < 200; i++) {
      const k = newBackupKey();
      const code = encodeRestoreCode(k);
      expect(code).toMatch(/^([0-9A-Z]{4}-){6}[0-9A-Z]{4}$/);
      expect(decodeRestoreCode(code)).toEqual({ ok: true, key: k });
    }
  });

  it('forgives case, spaces, dashes and look-alike letters', () => {
    const k = '0123456789ABCDEFGHJKMNPQRS';
    const code = encodeRestoreCode(k);
    const typed = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(normaliseCode(typed)).toBe(code.replace(/-/g, ''));
    expect(decodeRestoreCode(` ${typed} `)).toEqual({ ok: true, key: k });
  });

  it('catches every single typo and every swap of neighbours', () => {
    const k = newBackupKey();
    const s = encodeRestoreCode(k).replace(/-/g, '');
    for (let i = 0; i < s.length; i++) {
      for (const ch of ALPHABET) {
        if (ch === s[i]) continue;
        const typo = s.slice(0, i) + ch + s.slice(i + 1);
        expect(decodeRestoreCode(typo).ok).toBe(false);
      }
      if (i + 1 < s.length && s[i] !== s[i + 1]) {
        const swap = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
        expect(decodeRestoreCode(swap).ok).toBe(false);
      }
    }
  });

  it('says what is wrong', () => {
    expect(decodeRestoreCode('')).toMatchObject({ ok: false, error: expect.stringMatching(/Type the restore code/) });
    expect(decodeRestoreCode('ABCD-EFGH')).toMatchObject({ ok: false, error: expect.stringMatching(/28 characters/) });
    const code = encodeRestoreCode('0123456789ABCDEFGHJKMNPQRS');
    expect(decodeRestoreCode(code.slice(0, -1) + 'U')).toMatchObject({ ok: false, error: expect.stringMatching(/“U” isn't used/) });
    expect(() => encodeRestoreCode('short')).toThrow();
  });
});
