// Canvas renderer for the practice "piano-roll" highway: time flows right→left, pitch is vertical.
import type { Part, Score, KeySig } from '../../music/types';
import type { PitchSample, Grade } from '../../game/types';
import type { LiveScorer } from '../../game/scoring';
import { noteLabel, type NotationMode } from '../../game/notation';

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
}

export const COLORS = {
  bg: '#0F1226',
  row: '#1A1F3D',
  rowKey: '#141833',
  label: '#A8B0D6',
  target: '#FF7A45',
  targetSoft: '#2A1A16',
  targetText: '#FFB08F',
  voice: '#4CC9F0',
  voiceDeep: '#1D4F63',
  miss: '#FF5D73',
  ghost: '#4A5288',
  text: '#EEF0FF',
  measure: '#262B4D',
};

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
  c.font = '600 10px "JetBrains Mono", monospace';
  c.textBaseline = 'top';
  for (const ms of s.score.measures) {
    if (ms.start < tMin - 0.01 || ms.start > tMax) continue;
    const bx = Math.round(x(ms.start));
    c.fillStyle = COLORS.measure;
    c.fillRect(bx, top - 4, 1, H - top);
    c.fillStyle = COLORS.label;
    c.fillText(ms.number, bx + 3, 3);
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
    if (n.lyric) {
      c.font = `800 ${bh >= 22 ? 12 : 10}px "Bricolage Grotesque", sans-serif`;
      c.textBaseline = 'middle';
      const tw = c.measureText(n.lyric).width;
      if (tw + 6 <= nw && bh >= 14) {
        c.fillStyle = past || isNow ? '#0B0D1A' : COLORS.targetText;
        c.fillText(n.lyric, nx + (nw - tw) / 2, ny + bh / 2 + 1);
      } else {
        c.fillStyle = COLORS.targetText;
        c.fillText(n.lyric, nx, ny + bh + 8);
      }
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

  // Now line.
  c.fillStyle = 'rgba(238,240,255,0.85)';
  c.fillRect(Math.round(nowX) - 1, top - 6, 2, H - top + 6);

  // Live voice dot + cents bubble.
  const last = s.samples[s.samples.length - 1];
  if (last && last.midi != null && s.pos - last.time < 0.2) {
    const py = y(Math.max(lo - 0.4, Math.min(hi + 0.4, last.midi)));
    c.fillStyle = 'rgba(76,201,240,0.25)';
    c.beginPath();
    c.arc(nowX, py, 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = COLORS.voice;
    c.beginPath();
    c.arc(nowX, py, 6, 0, Math.PI * 2);
    c.fill();
    if (current >= 0) {
      const target = notes[current].midi;
      let cents = (last.midi - target) * 100;
      if (Math.abs(cents) > 600) cents = ((cents % 1200) + 1800) % 1200 - 600; // show octave-folded
      const txt = `${cents >= 0 ? '+' : '−'}${Math.round(Math.abs(cents))}¢`;
      c.font = '600 12px "JetBrains Mono", monospace';
      c.textBaseline = 'middle';
      const tw = c.measureText(txt).width;
      const bx = nowX + 14;
      const by = Math.max(top + 10, Math.min(H - 14, py - 22));
      const ok = Math.abs(cents) <= s.tolerance;
      c.fillStyle = '#0B0D1A';
      roundRect(c, bx, by - 11, tw + 14, 22, 7);
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
      const lab = noteLabel(m, s.notation, s.key);
      const isCur = current >= 0 && notes[current].midi === m;
      const diatonic = !/[♯♭#b]|^(di|ri|fi|si|li|ra|me|se|le|te)$/i.test(lab.text) || s.notation === 'pc';
      if (!diatonic && rowH < 16 && !isCur) continue;
      c.font = `${isCur ? 800 : diatonic ? 600 : 400} ${rowH < 14 ? 10 : 12}px "JetBrains Mono", monospace`;
      c.fillStyle = isCur ? COLORS.target : diatonic ? COLORS.label : '#6B739C';
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
