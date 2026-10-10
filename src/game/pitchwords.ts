// One word scale for pitch, everywhere a singer reads how far off a note was (Results, the mistake
// score, coach notes, the live readout): words first, cents after in brackets.
//
//   |cents| ≤ 10  "spot on"
//   10–25         "a touch flat / sharp"
//   25–50         "a little flat / sharp"
//   over 50       "clearly flat / sharp"
//
// (The intonation lab keeps its own words for the pulse; see IntonationLab.)

/** How far off, in words, without a direction: 'spot on' | 'a touch' | 'a little' | 'clearly'. */
export function pitchDegree(cents: number): 'spot on' | 'a touch' | 'a little' | 'clearly' {
  const a = Math.abs(Math.round(cents));
  if (a <= 10) return 'spot on';
  if (a <= 25) return 'a touch';
  if (a <= 50) return 'a little';
  return 'clearly';
}

/** "spot on", "a touch flat", "a little sharp", "clearly flat". */
export function pitchWords(cents: number): string {
  const d = pitchDegree(cents);
  return d === 'spot on' ? d : `${d} ${cents < 0 ? 'flat' : 'sharp'}`;
}

/** "clearly flat (65 cents)", "spot on" (no cents when spot on). */
export function pitchPhrase(cents: number): string {
  const d = pitchDegree(cents);
  if (d === 'spot on') return d;
  const a = Math.abs(Math.round(cents));
  return `${pitchWords(cents)} (${a} cent${a === 1 ? '' : 's'})`;
}

/** A short arrow tag for a note on the staff: "↓ clearly flat", "↑ a touch sharp", "spot on". */
export function pitchTag(cents: number): string {
  const d = pitchDegree(cents);
  return d === 'spot on' ? d : `${cents < 0 ? '↓' : '↑'} ${pitchWords(cents)}`;
}

/** The live readout while singing (a small bubble): "spot on", "↓ a touch", "↑ a little", "↓ clearly". */
export function pitchShort(cents: number): string {
  const d = pitchDegree(cents);
  return d === 'spot on' ? d : `${cents < 0 ? '↓' : '↑'} ${d}`;
}

/**
 * A level's tolerance in plain words: "half a semitone (50 cents)", "about a third of a semitone
 * (35 cents)". A semitone is 100 cents.
 */
export function toleranceWords(tol: number): string {
  const t = Math.round(Math.abs(tol));
  const part = (frac: string, exact: number) => `${Math.abs(t - exact) <= 1 ? '' : 'about '}${frac} of a semitone`;
  const words = t >= 90 ? (t >= 98 && t <= 102 ? 'a semitone' : 'about a semitone')
    : t >= 58 ? part('two thirds', 67)
      : t >= 42 ? (t === 50 ? 'half a semitone' : 'about half a semitone')
        : t >= 30 ? part('a third', 33)
          : t >= 22 ? part('a quarter', 25)
            : part('a fifth', 20);
  return `${words} (${t} cents)`;
}
