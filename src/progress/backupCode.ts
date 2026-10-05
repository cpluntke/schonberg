// The backup key and the restore code that carries it to a new phone.
//
// The key is 26 random Crockford base32 characters (130 bits). The restore code is the key plus two
// check characters, shown as 7 groups of 4 ("7K3M-9QX2-…"). The check is a position-weighted sum
// modulo the prime 1021, so any single mistyped character and any swap of two neighbours is caught.
// Typing is forgiving: lower case, spaces and dashes are fine, O reads as 0 and I / L as 1.

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_LEN = 26;
const CHECK_MOD = 1021;

function values(s: string): number[] | null {
  const out: number[] = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    out.push(v);
  }
  return out;
}

/** A new random backup key (26 characters, 130 bits). */
export function newBackupKey(rand: (n: number) => Uint8Array = randomBytes): string {
  return Array.from(rand(KEY_LEN), (b) => ALPHABET[b & 31]).join('');
}

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export function isBackupKey(k: unknown): k is string {
  return typeof k === 'string' && k.length === KEY_LEN && values(k) !== null;
}

function check(vals: number[]): string {
  let sum = 0;
  vals.forEach((v, i) => { sum = (sum + (i + 1) * v) % CHECK_MOD; });
  return ALPHABET[sum >> 5] + ALPHABET[sum & 31];
}

/** "7K3M-9QX2-ZC4V-B8NR-1T6W-HJP5-DA??" (key + 2 check characters, groups of 4). */
export function encodeRestoreCode(key: string): string {
  const vals = values(key);
  if (!vals || key.length !== KEY_LEN) throw new Error('Not a backup key');
  const all = key + check(vals);
  return all.match(/.{1,4}/g)!.join('-');
}

/** Normalise what someone typed: case, spaces, dashes, and the letters people confuse with digits. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-–—_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export type DecodeResult = { ok: true; key: string } | { ok: false; error: string };

/** The backup key in a restore code, or why the code can't be right. */
export function decodeRestoreCode(input: string): DecodeResult {
  const s = normaliseCode(input);
  if (!s) return { ok: false, error: 'Type the restore code from your other phone.' };
  if (s.length !== KEY_LEN + 2) {
    return { ok: false, error: `A restore code has ${KEY_LEN + 2} characters (7 groups of 4); this one has ${s.length}.` };
  }
  const vals = values(s);
  if (!vals) {
    const bad = [...s].find((ch) => !ALPHABET.includes(ch));
    return { ok: false, error: `“${bad}” isn't used in restore codes. Check the code again.` };
  }
  const key = s.slice(0, KEY_LEN);
  if (check(vals.slice(0, KEY_LEN)) !== s.slice(KEY_LEN)) {
    return { ok: false, error: 'This code has a typo somewhere. Check it character by character.' };
  }
  return { ok: true, key };
}
