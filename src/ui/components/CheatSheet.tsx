// Section leads and admins: the rehearsal cheat sheet of a piece. Score excerpts, in score order,
// with the notes at least two singers of the section keep getting wrong, each marked with what
// usually goes wrong and how many struggle (section counts only, never who: docs/PRIVACY.md).

import React, { useMemo, useRef } from 'react';
import type { Part } from '../../music/types';
import type { NotationMode } from '../../game/notation';
import type { NoteAgg } from '../../progress/insights';
import type { PieceInfo } from '../library';
import { loadProfile } from '../../progress/store';
import { barRangeLabel } from '../../music/sections';
import { mistakeSpots } from '../play/mistakeSpots';
import type { MistakeMark, MistakeOpts } from '../play/mistakeScore';
import type { FaultKind } from '../play/noteFault';
import { SnippetCanvas, nth, useFontsLoaded, useWidth } from './MistakeScore';

/** Short tag over the note / words in the captions. */
const TAG: Record<FaultKind, string> = { missed: 'not sung', octave: 'octave', wrong: 'wrong note', flat: '↓ flat', sharp: '↑ sharp', short: 'too short', unsteady: 'unsteady' };
const WORDS: Record<FaultKind, string> = {
  missed: 'not sung', octave: 'an octave off', wrong: 'a wrong note', flat: 'flat', sharp: 'sharp', short: 'too short (late or cut off)', unsteady: 'not steady',
};
const SP: [number, number] = [6.5, 8.5];
/** Excerpts at most (the bars with the most problem notes first; shown in score order). */
const MAX_SPOTS = 24;

const mainKind = (n: NoteAgg): FaultKind => (Object.entries(n.kinds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'missed') as FaultKind;
const kindsText = (n: NoteAgg) => Object.entries(n.kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${WORDS[k as FaultKind] ?? k} ${c}`).join(', ');

export function CheatSheet({ piece, part, notes, singers }: { piece: PieceInfo; part: Part; notes: NoteAgg[]; singers: number }) {
  const fonts = useFontsLoaded();
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const notation = loadProfile().notation as NotationMode;
  const { spots, marks, byIndex } = useMemo(() => {
    const valid = notes.filter((n) => part.notes[n.i] != null);
    const byIndex = new Map(valid.map((n) => [n.i, n]));
    const last = piece.score.measures.length - 1;
    const r = mistakeSpots(valid.map((n) => ({ index: n.i, measure: part.notes[n.i].measure })), { lo: 0, hi: last, context: 1, maxBars: 5, maxSpots: MAX_SPOTS });
    const spots = [...r.spots].sort((a, b) => a.m0 - b.m0);
    const marks = spots.map((s) => s.notes.map((i): MistakeMark => {
      const n = byIndex.get(i)!;
      return { index: i, fault: { kind: mainKind(n), cents: null }, targetOffset: 0, tag: `${TAG[mainKind(n)]} · ${n.n}/${singers}` };
    }));
    return { spots, marks, byIndex };
  }, [piece, part, notes, singers]);
  const opts: MistakeOpts = { sp: SP, fitWidth: width, notation, names: true };
  return (
    <div ref={wrapRef} className="col" style={{ gap: 12 }} data-testid="cheat-sheet">
      {!spots.length ? (
        <span className="small muted" data-testid="cheat-empty">
          No note yet that two or more singers keep getting wrong (it shows for a part once three or more of its singers share). It fills in as
          the section practises with the current app version: earlier runs didn't keep notes.
        </span>
      ) : (
        <span className="tiny muted">
          In score order. Each marked note: what usually goes wrong · how many of the part's {singers} singers sharing keep getting it wrong (recent runs count most).
          Counted together, never by name; in a small section a change right after someone's run may still hint at whose it was.
        </span>
      )}
      {spots.map((s, k) => (
        <div key={`${s.m0}-${s.m1}`} className="col" style={{ gap: 4 }}>
          <strong className="small">{barRangeLabel(piece.score, s.m0, s.m1)}</strong>
          <div style={{ overflowX: 'auto', borderRadius: 10 }}>
            <SnippetCanvas piece={piece} part={part} spot={s} marks={marks[k]} opts={opts} fonts={fonts}
              label={`${barRangeLabel(piece.score, s.m0, s.m1)}: ${s.notes.length} note${s.notes.length === 1 ? '' : 's'} the section keeps getting wrong`} />
          </div>
          {s.bars.map((m) => (
            <span key={m} className="small" data-testid="cheat-bar">
              <strong>{barRangeLabel(piece.score, m, m)}:</strong>{' '}
              {s.notes.filter((i) => part.notes[i]?.measure === m).map((i, j) => {
                const n = byIndex.get(i)!;
                const ly = part.notes[i]?.lyric;
                return <span key={i}>{j ? '; ' : ''}note {nth(part, i)}{ly ? ` (“${ly}”)` : ''}: {n.n} of {singers} ({kindsText(n)})</span>;
              })}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
