// The range check's pattern on a small staff: the notes to sing, as noteheads without stems (no
// rhythm: the singer takes their own pace). The note being played lights up; while singing, the
// notes sung so far turn the voice colour and the next one is marked.

import React from 'react';
import { F_CLEF, G_CLEF, GLYPH_UNITS_PER_SPACE } from '../play/clefGlyphs';
import { middleStep, spell, type Clef } from '../play/staff2d';

/** Major key (fifths) of each pitch class, the simpler of sharps and flats: do-re-mi is spelled C-D-E, F♯-G♯-A♯, B♭-C-D. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export type NoteState = 'todo' | 'now' | 'done' | 'bad';

const SP = 9; // staff space (px)
const NOTE_GAP = 4.2; // staff spaces between noteheads

export function PatternStaff({ notes, root, states, label }: {
  notes: number[];
  /** The pattern's root (do): sets the spelling. */
  root: number;
  states: NoteState[];
  label: string;
}) {
  // (by pitch, as staff2d's clefFor does for an unknown voice: the check may come before the voice is chosen)
  const avg = notes.reduce((a, m) => a + m, 0) / notes.length;
  const clef: Clef = avg >= 59 ? 'treble' : avg >= 52 ? 'treble8' : 'bass';
  const key = { fifths: MAJOR_FIFTHS[((root % 12) + 12) % 12], mode: 'major' as const };
  const mid = middleStep(clef);
  const spelled = notes.map((m) => spell(m, key));
  // Vertical extent: the staff (mid ± 4 steps) and every note with its ledger lines, plus the clef.
  const top = Math.max(mid + 6, ...spelled.map((s) => s.step + 2));
  const bottom = Math.min(mid - 6, ...spelled.map((s) => s.step - 2));
  const y = (step: number) => (top - step) * (SP / 2) + SP;
  const height = y(bottom) + SP;
  const x0 = 4.2 * SP;
  const width = x0 + notes.length * NOTE_GAP * SP + SP;
  const lineSteps = [-4, -2, 0, 2, 4].map((d) => mid + d);
  const k = SP / GLYPH_UNITS_PER_SPACE;
  const clefLine = clef === 'bass' ? mid + 2 : mid - 2; // F line / G line
  const colour = (s: NoteState) => (s === 'done' ? 'var(--voice)' : s === 'now' ? 'var(--accent)' : s === 'bad' ? 'var(--bad)' : 'var(--text)');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ maxWidth: '100%', height: 'auto', overflow: 'visible' }}
      role="img" aria-label={label} data-testid="range-staff">
      {lineSteps.map((s) => <line key={s} x1={0} x2={width} y1={y(s)} y2={y(s)} stroke="var(--muted)" strokeWidth={1} opacity={0.7} />)}
      <path d={clef === 'bass' ? F_CLEF : G_CLEF} fill="var(--text)" transform={`translate(${0.4 * SP} ${y(clefLine)}) scale(${k} ${-k})`} />
      {clef === 'treble8' && (
        <text x={1.75 * SP} y={y(clefLine) + 3.9 * SP} fontSize={SP * 1.1} fontWeight={700} fontFamily="Georgia, serif" textAnchor="middle" fill="var(--text)">8</text>
      )}
      {spelled.map((s, i) => {
        const cx = x0 + (i + 0.5) * NOTE_GAP * SP;
        const cy = y(s.step);
        const c = colour(states[i] ?? 'todo');
        // Ledger lines: every line step beyond the staff, up to the note.
        const ledgers: number[] = [];
        for (let l = mid + 6; l <= s.step; l += 2) ledgers.push(l);
        for (let l = mid - 6; l >= s.step; l -= 2) ledgers.push(l);
        return (
          <g key={i} data-state={states[i]}>
            {ledgers.map((l) => <line key={l} x1={cx - 1.05 * SP} x2={cx + 1.05 * SP} y1={y(l)} y2={y(l)} stroke="var(--muted)" strokeWidth={1.2} />)}
            {s.alt !== 0 && (
              <text x={cx - 1.15 * SP} y={cy + 0.42 * SP} fontSize={SP * 1.7} textAnchor="end" fill={c} fontFamily="Georgia, 'Times New Roman', serif">
                {s.alt > 0 ? (s.alt > 1 ? '𝄪' : '♯') : s.alt < -1 ? '𝄫' : '♭'}
              </text>
            )}
            {states[i] === 'now' && <circle cx={cx} cy={cy} r={1.25 * SP} fill="var(--accent)" opacity={0.18} />}
            <ellipse cx={cx} cy={cy} rx={0.66 * SP} ry={0.46 * SP} transform={`rotate(-20 ${cx} ${cy})`} fill={c} />
          </g>
        );
      })}
    </svg>
  );
}
