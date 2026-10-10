// Canvas renderer for the practice "piano-roll" highway: time flows right→left, pitch is vertical.
import { pitchShort } from '../../game/pitchwords';
import type { Part, Score, KeySig } from '../../music/types';
import type { PitchSample, Grade } from '../../game/types';
import type { LiveScorer } from '../../game/scoring';
import { keyHint, movesWithKey, noteLabel, type NotationMode } from '../../game/notation';
import { keyAtTimeIn } from '../../music/keymarks';
import { nameKeysOf } from '../../progress/keymarks';
import { COLORS, fpx } from './palette';

export interface DrawState {
  score: Score;
  part: Part;
  range: [number, number] | null;
  pos: number;
  rate: number;
  samples: PitchSample[];
  live: LiveScorer | null;
  notation: NotationMode;
  showNames: boolean;
  key: KeySig;
  tolerance: number;
  ghostParts: Part[];
  /** Precomputed pitch window. */
  lo: number;
  hi: number;
  from: number;
  to: number;
  /** Length of one felt beat in score seconds at the current position (entry countdowns). */
  beatSec: number;
  /**
   * Off book: how to draw your note `i` before it has been sung. 'show' = normally, 'letters' =
   * no pitch, just the first letter of its word on the bottom line, 'none' = nothing.
   * Notes already sung are always shown (with their grade), as feedback.
   */
  hide?: (i: number) => 'show' | 'letters' | 'none';
  /** Score view on a wide screen: your staff only, all voices, or all voices + accompaniment. */
  staves?: 'mine' | 'voices' | 'all';
  /** Score view: one line that scrolls smoothly past the playhead instead of turning pages. */
  scroll?: boolean;
  /** The words are only for orientation (level 1 is sung on "doo"): draw them dimmed. */
  dimLyrics?: boolean;
  /** Score view on a phone: the screen shows the live reading in big words (Play's readout), so
   *  the canvas draws only the voice dot, not its small bubble. */
  readout?: boolean;
}

/** First letter of the word a syllable starts ("" for a syllable inside a word). */
export function wordInitial(n: { lyric?: string; syllabic?: string }): string {
  if (!n.lyric || n.syllabic === 'middle' || n.syllabic === 'end') return '';
  const m = /[\p{L}\p{N}]/u.exec(n.lyric);
  return m ? m[0] : '';
}

export { COLORS } from './palette';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** Is `midi` in the scale of `key` (major, or natural/harmonic minor)? */
export function inKey(midi: number, key: { fifths: number; mode: 'major' | 'minor' }): boolean {
  const majorTonic = ((key.fifths * 7) % 12 + 12) % 12;
  const rel = (((midi - majorTonic) % 12) + 12) % 12;
  if (MAJOR.includes(rel)) return true;
  // raised 7th of the relative minor (e.g. G♯ in A minor)
  return key.mode === 'minor' && rel === 8;
}

export function pitchWindow(part: Part, range: [number, number] | null): [number, number] {
  const notes = range ? part.notes.slice(range[0], range[1] + 1) : part.notes;
  if (!notes.length) return [55, 72];
  let lo = Math.min(...notes.map((n) => n.midi)) - 2;
  let hi = Math.max(...notes.map((n) => n.midi)) + 2;
  while (hi - lo < 12) {
    hi++;
    if (hi - lo < 12) lo--;
  }
  return [lo, hi];
}

export function gradeColor(g: Grade | undefined): string {
  if (g === 'perfect' || g === 'good') return COLORS.voice;
  if (g === 'ok') return COLORS.voiceDeep;
  if (g === 'miss') return COLORS.miss;
  return COLORS.target;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

export function drawHighway2D(c: CanvasRenderingContext2D, W: number, H: number, s: DrawState) {
  const gutter = s.showNames ? 46 : 14;
  const nowX = gutter + (W - gutter) * 0.28;
  const pps = 150 / Math.max(0.3, s.rate); // px per score second (constant real-time speed)
  const { lo, hi } = s;
  const rows = hi - lo + 1;
  const top = 18;
  const rowH = (H - top - 6) / rows;
  const y = (m: number) => top + (hi - m + 0.5) * rowH;
  const x = (t: number) => nowX + (t - s.pos) * pps;
  const tMin = s.pos - (nowX - gutter) / pps;
  const tMax = s.pos + (W - nowX) / pps;

  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, W, H);

  // Semitone rows; tonic rows slightly emphasised.
  const tonicPc = ((s.key.mode === 'minor' ? 9 : 0) + s.key.fifths * 7 + 1200) % 12;
  for (let m = lo; m <= hi; m++) {
    if (((m % 12) + 12) % 12 === tonicPc) {
      c.fillStyle = COLORS.rowKey;
      c.fillRect(gutter, y(m) - rowH / 2, W - gutter, rowH);
    }
    c.fillStyle = COLORS.row;
    c.fillRect(gutter, Math.round(y(m)), W - gutter, 1);
  }

  // Bar lines + numbers.
  c.font = `600 ${fpx(11)}px "JetBrains Mono", monospace`;
  c.textBaseline = 'top';
  for (const ms of s.score.measures) {
    if (ms.start < tMin - 0.01 || ms.start > tMax) continue;
    const bx = Math.round(x(ms.start));
    c.fillStyle = COLORS.measure;
    c.fillRect(bx, top - 4, 1, H - top);
    c.fillStyle = COLORS.label;
    c.fillText(ms.number, bx + 3, 3);
  }

  // Where the names' do moves (a new key signature or an admin's key mark): a dashed line and "Do = …".
  const nks = nameKeysOf(s.score);
  for (let k = 1; k < nks.length && movesWithKey(s.notation); k++) {
    const kt = nks[k].time;
    if (kt < tMin - 0.01 || kt > tMax || nks[k].fifths === nks[k - 1].fifths) continue;
    const hint = keyHint(s.notation, nks[k]);
    const kx = Math.round(x(kt));
    c.strokeStyle = COLORS.targetText;
    c.globalAlpha = 0.7;
    c.lineWidth = 1.5;
    c.setLineDash([5, 4]);
    c.beginPath();
    c.moveTo(kx + 0.5, top - 4);
    c.lineTo(kx + 0.5, H);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
    if (hint) {
      c.font = `700 ${fpx(12)}px system-ui, sans-serif`;
      c.textBaseline = 'top';
      const tw = c.measureText(hint).width;
      const hx = Math.max(gutter + 2, kx + 4);
      c.fillStyle = COLORS.bubble;
      roundRect(c, hx - 3, 16, tw + 8, fpx(12) + 5, 5);
      c.fill();
      c.fillStyle = COLORS.targetText;
      c.fillText(hint, hx + 1, 18);
    }
  }

  // Directions (dynamics, tempo words) along the bottom edge.
  const dirs = [
    ...(s.part.directions ?? []),
    ...s.ghostParts.flatMap((g) => (g.directions ?? []).filter((d) => d.kind === 'words')),
  ];
  if (dirs.length) {
    let lastX = -1e9;
    let lastText = '';
    const sorted = [...dirs].sort((a, b) => a.time - b.time);
    for (const d of sorted) {
      if (d.time < tMin - 2 || d.time > tMax) continue;
      if (/\d{4}/.test(d.text) || (d.kind === 'words' && (s.score.title.includes(d.text) || s.score.composer.includes(d.text) || /^[A-ZÀ-Ý][\p{L}'’-]+(\s[A-ZÀ-Ý][\p{L}'’-]+)+$/u.test(d.text)))) continue;
      if (d.text === lastText && Math.abs(x(d.time) - lastX) < 4) continue;
      const dx = Math.max(gutter + 2, x(d.time));
      if (dx - lastX < 30 && d.text === lastText) continue;
      c.font = d.kind === 'dynamic' ? `italic 800 ${fpx(15)}px Georgia, serif` : `italic 500 ${fpx(12)}px Georgia, serif`;
      c.textBaseline = 'alphabetic';
      c.fillStyle = COLORS.targetText;
      c.globalAlpha = 0.85;
      c.fillText(d.text, dx + 2, d.kind === 'dynamic' ? H - 6 : H - 24);
      c.globalAlpha = 1;
      lastX = dx;
      lastText = d.text;
    }
  }

  // Other voices as dashed ghosts.
  c.setLineDash([4, 3]);
  c.lineWidth = 1;
  c.strokeStyle = COLORS.ghost;
  for (const gp of s.ghostParts) {
    for (const n of gp.notes) {
      if (n.start + n.dur < tMin || n.start > tMax) continue;
      if (n.midi < lo || n.midi > hi) continue;
      const h = Math.max(6, rowH * 0.45);
      roundRect(c, x(n.start) + 1, y(n.midi) - h / 2, Math.max(4, n.dur * pps - 2), h, 4);
      c.stroke();
    }
  }
  c.setLineDash([]);

  // Target notes.
  const notes = s.part.notes;
  const [ra, rb] = s.range ?? [0, notes.length - 1];
  const bh = Math.max(10, Math.min(34, rowH * 0.82));
  let current = -1;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.start + n.dur < tMin || n.start > tMax) continue;
    const inRange = i >= ra && i <= rb && s.range != null;
    const nx = x(n.start) + 1;
    const nw = Math.max(6, n.dur * pps - 2);
    const ny = y(Math.max(lo, Math.min(hi, n.midi))) - bh / 2;
    const isNow = n.start <= s.pos && s.pos < n.start + n.dur;
    if (isNow && inRange) current = i;
    const past = n.start + n.dur <= s.pos;
    const vis = (past && inRange) || !s.hide ? 'show' : s.hide(i);
    if (vis !== 'show') {
      if (vis === 'letters' && inRange) {
        const ch = wordInitial(n);
        c.fillStyle = isNow ? COLORS.target : COLORS.targetText;
        c.globalAlpha = isNow ? 1 : 0.8;
        c.fillRect(nx, H - 44, Math.max(2, nw), 2); // rhythm: where the note sits, not its pitch
        if (ch) {
          c.font = `800 ${fpx(15)}px "Bricolage Grotesque", sans-serif`;
          c.textBaseline = 'alphabetic';
          c.fillText(ch, nx, H - 50);
        }
        c.globalAlpha = 1;
      }
      continue;
    }
    if (!inRange) {
      c.globalAlpha = 0.35;
      c.strokeStyle = COLORS.target;
      c.lineWidth = 1.5;
      roundRect(c, nx, ny, nw, bh, 7);
      c.stroke();
      c.globalAlpha = 1;
      continue;
    }
    if (past) {
      const g = s.live?.noteGrade(i);
      c.fillStyle = gradeColor(g);
      c.globalAlpha = g === 'miss' ? 0.55 : 1;
      roundRect(c, nx, ny, nw, bh, 7);
      c.fill();
      c.globalAlpha = 1;
    } else if (isNow) {
      c.shadowColor = COLORS.target;
      c.shadowBlur = 16;
      c.fillStyle = COLORS.target;
      roundRect(c, nx, ny, nw, bh, 7);
      c.fill();
      c.shadowBlur = 0;
      const fill = s.live?.noteFill(i) ?? 0;
      if (fill > 0) {
        c.save();
        roundRect(c, nx, ny, nw, bh, 7);
        c.clip();
        c.fillStyle = COLORS.voice;
        c.fillRect(nx, ny + bh * (1 - fill), nw, bh * fill);
        c.restore();
      }
    } else {
      c.fillStyle = COLORS.targetSoft;
      roundRect(c, nx, ny, nw, bh, 7);
      c.fill();
      c.strokeStyle = COLORS.target;
      c.lineWidth = 2;
      c.stroke();
    }
    // A note past a change of do: the gutter still names the rows in the key at the playhead, so
    // the note carries its own name until the playhead reaches the change.
    if (s.showNames && !past && nks.length > 1 && movesWithKey(s.notation)) {
      const nk = keyAtTimeIn(nks, n.start);
      if (nk.fifths !== s.key.fifths) {
        c.font = `700 ${fpx(12)}px "JetBrains Mono", monospace`;
        c.textBaseline = 'alphabetic';
        c.fillStyle = COLORS.targetText;
        c.fillText(noteLabel(n.midi, s.notation, nk, n.spelling).text, nx + 2, ny - 3);
      }
    }
    if (n.lyric) {
      c.save();
      if (s.dimLyrics) c.globalAlpha *= 0.45;
      c.font = `800 ${fpx(bh >= 22 ? 12 : 10)}px "Bricolage Grotesque", sans-serif`;
      c.textBaseline = 'middle';
      const tw = c.measureText(n.lyric).width;
      if (tw + 6 <= nw && bh >= 14) {
        c.fillStyle = past || isNow ? COLORS.onFill : COLORS.targetText;
        c.fillText(n.lyric, nx + (nw - tw) / 2, ny + bh / 2 + 1);
      } else {
        c.fillStyle = COLORS.targetText;
        c.fillText(n.lyric, nx, ny + bh + 8);
      }
      c.restore();
    }
  }

  // Pitch trace.
  c.lineWidth = 3;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = COLORS.voice;
  let drawing = false;
  let lastT = -1;
  c.beginPath();
  for (let i = Math.max(0, s.samples.length - 400); i < s.samples.length; i++) {
    const sm = s.samples[i];
    if (sm.time < tMin || sm.time > s.pos + 0.05) continue;
    if (sm.midi == null || sm.time - lastT > 0.12) {
      drawing = false;
      if (sm.midi == null) continue;
    }
    const px = x(sm.time);
    const py = y(Math.max(lo - 0.4, Math.min(hi + 0.4, sm.midi)));
    if (!drawing) c.moveTo(px, py);
    else c.lineTo(px, py);
    drawing = true;
    lastT = sm.time;
  }
  c.stroke();

  // Entry countdown: when your next note comes after a rest, count the last beats in.
  if (s.range) {
    const [a2, b2] = s.range;
    for (let i = a2; i <= b2; i++) {
      const n = notes[i];
      if (n.start < s.pos) continue;
      const prev = i > 0 ? notes[i - 1] : null;
      const afterRest = !prev || n.start - (prev.start + prev.dur) >= 0.6;
      const beat = Math.max(0.15, s.beatSec);
      const ahead = n.start - s.pos;
      if (afterRest && ahead <= 3 * beat && s.pos >= s.from - 0.01) {
        const k = Math.ceil(ahead / beat - 1e-6);
        // Off book the countdown mustn't give the pitch away.
        const ey = s.hide && s.hide(i) !== 'show' ? top + 40 : y(Math.max(lo, Math.min(hi, n.midi)));
        c.font = `800 ${fpx(22)}px "Bricolage Grotesque", sans-serif`;
        c.textBaseline = 'middle';
        c.fillStyle = COLORS.target;
        c.globalAlpha = 0.9;
        const txt = k > 0 ? String(k) : '';
        if (txt) c.fillText(txt, Math.min(W - 24, x(n.start) - 22), ey - bh / 2 - 14);
        c.globalAlpha = 1;
      }
      break;
    }
  }

  // Now line.
  c.fillStyle = COLORS.playhead;
  c.fillRect(Math.round(nowX) - 1, top - 6, 2, H - top + 6);

  // Live voice dot + cents bubble.
  const last = s.samples[s.samples.length - 1];
  if (last && last.midi != null && s.pos - last.time < 0.2) {
    const py = y(Math.max(lo - 0.4, Math.min(hi + 0.4, last.midi)));
    c.fillStyle = COLORS.voiceHalo;
    c.beginPath();
    c.arc(nowX, py, 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = COLORS.voice;
    c.beginPath();
    c.arc(nowX, py, 6, 0, Math.PI * 2);
    c.fill();
    // Compare the reading with the note that was due when it was SUNG (its own score time), not
    // the note under the playhead: the voice reaches us a moment later, and comparing it with the
    // next note made every note change look like a big overshoot.
    let heard = -1;
    if (s.range) {
      const [h0, h1] = s.range;
      for (let i = h0; i <= h1; i++) {
        if (notes[i].start > last.time) break;
        if (last.time < notes[i].start + notes[i].dur) heard = i;
      }
    }
    if (heard >= 0 && !(s.hide && s.hide(heard) !== 'show' && notes[heard].start + notes[heard].dur > s.pos)) {
      const target = notes[heard].midi;
      // Average over ~one vibrato cycle so the readout doesn't flicker.
      let sum = 0;
      let cnt = 0;
      // (only readings from this note: the previous pitch mustn't leak into the average)
      for (let k = s.samples.length - 1; k >= 0 && last.time - s.samples[k].time < 0.2 && s.samples[k].time >= notes[heard].start; k--) {
        const mm = s.samples[k].midi;
        if (mm != null && Math.abs(mm - last.midi) < 1.5) { sum += mm; cnt++; }
      }
      const shown = cnt ? sum / cnt : last.midi;
      let cents = (shown - target) * 100;
      if (Math.abs(cents) > 600) cents = ((cents % 1200) + 1800) % 1200 - 600; // show octave-folded
      const txt = pitchShort(cents);
      c.font = `600 ${fpx(12)}px "JetBrains Mono", monospace`;
      c.textBaseline = 'middle';
      const tw = c.measureText(txt).width;
      const bx = nowX + 14;
      const by = Math.max(top + 10, Math.min(H - 14, py - 22));
      const ok = Math.abs(cents) <= s.tolerance;
      const bh2 = fpx(12) + 10;
      c.fillStyle = COLORS.bubble;
      roundRect(c, bx, by - bh2 / 2, tw + 14, bh2, 7);
      c.fill();
      c.strokeStyle = ok ? COLORS.voice : COLORS.target;
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = ok ? COLORS.voice : COLORS.targetText;
      c.fillText(txt, bx + 7, by + 1);
    }
  }

  // Gutter labels drawn last so they sit on top.
  if (s.showNames) {
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, gutter, H);
    c.textBaseline = 'middle';
    for (let m = lo; m <= hi; m++) {
      const isCur = current >= 0 && notes[current].midi === m;
      // (the current note's row is named as the note is written: B♯, not C)
      const lab = noteLabel(m, s.notation, s.key, isCur ? notes[current].spelling : undefined);
      const diatonic = inKey(m, s.key) || s.notation === 'pc';
      if (!diatonic && rowH < 16 && !isCur) continue;
      c.font = `${isCur ? 800 : diatonic ? 600 : 400} ${fpx(rowH < 14 ? 10 : 12)}px "JetBrains Mono", monospace`;
      c.fillStyle = isCur ? COLORS.target : diatonic ? COLORS.label : COLORS.labelDim;
      const tw = c.measureText(lab.text).width;
      const lx = (gutter - tw) / 2;
      c.fillText(lab.text, lx, y(m) + 1);
      if (lab.dotsAbove || lab.dotsBelow) {
        const dots = lab.dotsAbove || lab.dotsBelow;
        for (let d = 0; d < dots; d++) {
          const dy = lab.dotsAbove ? y(m) - 8 - d * 4 : y(m) + 9 + d * 4;
          c.beginPath();
          c.arc(lx + tw / 2, dy, 1.6, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    c.fillStyle = COLORS.measure;
    c.fillRect(gutter - 1, 0, 1, H);
  }
}
