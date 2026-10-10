import React, { useState } from 'react';
import type { PieceInfo } from '../library';
import type { KeySig } from '../../music/types';
import type { KeyMark } from '../../music/keymarks';
import { keyName, keyHint } from '../../game/notation';
import { choirPieceOf, marksFor, nameKeysOf, saveLocalMarks } from '../../progress/keymarks';
import { sessionAuth, sessionFor, setChoirPieceKeys, superAuth } from '../../progress/choir';
import { useStoreVersion } from '../hooks';

const inputStyle: React.CSSProperties = { minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 10px' };

/** Every key, as a select value "fifths:mode". */
const KEYS: { value: string; label: string }[] = (['major', 'minor'] as const).flatMap((mode) =>
  Array.from({ length: 15 }, (_, i) => i - 7).map((fifths) => ({
    value: `${fifths}:${mode}`,
    label: `${keyName({ fifths, mode })} (${keyHint('movable', { fifths, mode })})`,
  })),
).sort((a, b) => {
  const ma = a.value.endsWith('major');
  if (ma !== b.value.endsWith('major')) return ma ? -1 : 1;
  const acc = (l: string) => (l[1] === '♭' ? 0 : l[1] === '♯' ? 2 : 1);
  return a.label[0].localeCompare(b.label[0]) || acc(a.label) - acc(b.label);
});
const AS_WRITTEN = 'score';

interface Row {
  bar: string;
  key: string;
  /** The bar (index) the row was loaded with: kept while its number is unchanged (numbers can repeat). */
  idx?: number;
}

/** Bar (index) of a beat. */
function barAt(piece: PieceInfo, beat: number): number {
  const ms = piece.score.measures;
  let i = 0;
  while (i + 1 < ms.length && ms[i + 1].startBeat <= beat + 1e-6) i++;
  return i;
}

/**
 * The piece's keys as the note names follow them (movable do, 1-7), and, for whoever may change
 * them, the key marks: "from bar 41, G major", where the music changes key without a new key
 * signature. A choir piece's marks are set by the choir's admins and reach every singer.
 */
export function KeyMarksCard({ piece }: { piece: PieceInfo }) {
  useStoreVersion();
  const score = piece.score;
  const ms = score.measures;
  const choirPiece = score.choir ? choirPieceOf(score) : null;
  const session = score.choir ? sessionFor(score.choir) : null;
  const auth = !score.choir ? null : session?.account.role === 'admin' ? sessionAuth(session) : superAuth();
  const canEdit = score.choir ? !!(auth && choirPiece) : !piece.builtin;
  const marks = marksFor(score);
  const keys = nameKeysOf(score);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const markBars = new Set(marks.map((m) => m.bar));
  const line = (k: KeySig, i: number) => {
    const bar = barAt(piece, k.beat);
    const marked = markBars.has(bar);
    return (
      <li key={i}>
        <span>{i === 0 ? 'From the start' : `Bar ${ms[bar]?.number ?? bar + 1}`}: </span>
        <strong>{keyName(k)}</strong>
        <span className="muted">, {keyHint('movable', k)}, {keyHint('jianpu', k)}</span>
        {marked && <span className="tiny muted"> (key mark)</span>}
      </li>
    );
  };

  const startEdit = () => {
    setError(null);
    setRows(marks.map((m) => ({ bar: ms[m.bar]?.number ?? String(m.bar + 1), key: m.fifths == null ? AS_WRITTEN : `${m.fifths}:${m.mode}`, idx: m.bar })));
  };

  const save = async () => {
    if (!rows) return;
    const out: KeyMark[] = [];
    for (const r of rows) {
      const t = r.bar.trim();
      if (!t) { setError('Enter the bar where the key changes.'); return; }
      const bar = r.idx != null && ms[r.idx]?.number === t ? r.idx : ms.findIndex((m) => m.number === t);
      if (bar < 0) { setError(`There is no bar “${t}” in this piece.`); return; }
      if (out.some((m) => m.bar === bar)) { setError(`Bar ${r.bar.trim()} is marked twice.`); return; }
      if (r.key === AS_WRITTEN) out.push({ bar });
      else {
        const [f, mode] = r.key.split(':');
        out.push({ bar, fifths: Number(f), mode: mode === 'minor' ? 'minor' : 'major' });
      }
    }
    out.sort((a, b) => a.bar - b.bar);
    setSaving(true);
    setError(null);
    try {
      if (score.choir) {
        if (!auth || !choirPiece) throw new Error('Only the choir’s admins can change this.');
        await setChoirPieceKeys(score.choir, auth, choirPiece.id, out);
      } else saveLocalMarks(score.id, out);
      setRows(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="card flat" data-testid="key-marks">
      <summary style={{ cursor: 'pointer' }}>
        <strong>Key and do</strong>
        <span className="small muted"> · {keyName(keys[0] ?? { fifths: 0, mode: 'major' })}, {keyHint('movable', keys[0] ?? { fifths: 0, mode: 'major' })}
          {keys.length > 1 ? ` · ${keys.length - 1} ${keys.length === 2 ? 'change' : 'changes'}` : ''}</span>
      </summary>
      <span className="small muted">
        Movable do and the 1–7 numbers start from the key: do (1) is the tonic of the major key with this key signature,
        also in minor (A minor: do = C, so A is la). Where the key signature changes, do moves with it.
      </span>
      <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }} data-testid="key-list">{keys.map(line)}</ul>
      {marks.length > 0 && (
        <span className="tiny muted" data-testid="key-marks-list">
          Key marks: {marks.map((m) => `bar ${ms[m.bar]?.number ?? m.bar + 1} → ${m.fifths == null ? 'the key signature' : keyName({ fifths: m.fifths, mode: m.mode ?? 'major' })}`).join('; ')}
        </span>
      )}
      {rows == null ? (
        canEdit ? (
          <div className="col" style={{ gap: 6 }}>
            <span className="small muted">
              Where the music changes key without a new key signature (only accidentals), or the file names the wrong key,
              mark it: from that bar on, do moves to the key you choose. The printed key signature stays as it is.
              {score.choir ? ' Saved for everyone in the choir.' : ' Saved on this device.'}
            </span>
            <div className="row wrap"><button className="btn small" onClick={startEdit} data-testid="key-marks-edit">{marks.length ? 'Change key marks' : 'Add a key mark'}</button></div>
          </div>
        ) : marks.length ? <span className="tiny muted">Key marks set by your choir’s admins.</span> : null
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {rows.map((r, i) => (
            <div key={i} className="row wrap" style={{ gap: 6, alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
              <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>From bar
                <input type="text" aria-label="Bar" placeholder="41" value={r.bar} style={{ ...inputStyle, width: 64 }} data-testid="key-mark-bar"
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, bar: e.target.value } : x)))} />
              </label>
              <select aria-label="Key" value={r.key} style={{ ...inputStyle, maxWidth: '100%' }} data-testid="key-mark-key"
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
                <option value={AS_WRITTEN}>Back to the key signature</option>
                {KEYS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button className="btn small" aria-label="Remove this key mark" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn small" data-testid="key-mark-add" onClick={() => {
              const k = keys[0] ?? { fifths: 0, mode: 'major' as const };
              setRows([...rows, { bar: '', key: `${k.fifths}:${k.mode}` }]);
            }}>Add a key mark</button>
            <span className="grow" />
            <button className="btn small" onClick={() => { setRows(null); setError(null); }}>Cancel</button>
            <button className="btn small primary" disabled={saving} onClick={save} data-testid="key-marks-save">{saving ? 'Saving…' : 'Save'}</button>
          </div>
          {error && <span className="small" style={{ color: 'var(--accent-text)' }} role="alert">{error}</span>}
        </div>
      )}
    </details>
  );
}
