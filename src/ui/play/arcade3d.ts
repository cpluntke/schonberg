// Canvas renderer for "arcade" mode: notes rush toward you down perspective lanes, one lane per pitch.
import type { Grade } from '../../game/types';
import { noteLabel } from '../../game/notation';
import { COLORS, gradeColor, type DrawState } from './highway2d';

export interface Popup { text: string; color: string; born: number }
export interface Spark { x: number; y: number; vx: number; vy: number; born: number; color: string }

export interface ArcadeFx {
  popups: Popup[];
  sparks: Spark[];
  lastGraded: number;
}

export function newFx(): ArcadeFx {
  return { popups: [], sparks: [], lastGraded: -1 };
}

const GRADE_TEXT: Record<Grade, string> = { perfect: 'PERFECT', good: 'GOOD', ok: 'OK', miss: 'MISS' };

export function lanesFor(s: DrawState): number[] {
  const notes = s.range ? s.part.notes.slice(s.range[0], s.range[1] + 1) : s.part.notes;
  const set = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
  if (set.length === 0) return [60, 62, 64];
  if (set.length === 1) return [set[0] - 2, set[0], set[0] + 2];
  return set;
}

/** Continuous lane position (0..n-1) for a sung pitch, interpolating between lane pitches. */
function laneOf(midi: number, lanes: number[]): number {
  if (midi <= lanes[0]) return Math.max(-0.6, (midi - lanes[0]) / 2);
  const n = lanes.length;
  if (midi >= lanes[n - 1]) return Math.min(n - 0.4, n - 1 + (midi - lanes[n - 1]) / 2);
  for (let i = 0; i < n - 1; i++) {
    if (midi <= lanes[i + 1]) return i + (midi - lanes[i]) / (lanes[i + 1] - lanes[i]);
  }
  return n - 1;
}

export function drawArcade(c: CanvasRenderingContext2D, W: number, H: number, s: DrawState, fx: ArcadeFx, lanes: number[], now: number) {
  const horizonY = H * 0.1;
  const strikeY = H * (s.showNames ? 0.84 : 0.88);
  const cx = W / 2;
  const halfW = Math.min(W * 0.46, 260);
  const ahead = 2.6 * s.rate; // score seconds visible ahead
  const K = 5;
  const scale = (z: number) => 1 / (1 + K * z);
  const Y = (z: number) => horizonY + (strikeY - horizonY) * scale(z);
  const n = lanes.length;
  const X = (lane: number, z: number) => cx + ((lane + 0.5) / n - 0.5) * 2 * halfW * scale(z);
  const zOf = (t: number) => (t - s.pos) / ahead;

  // Background.
  c.fillStyle = '#070812';
  c.fillRect(0, 0, W, H);

  // Track.
  const zBack = 1.0;
  const zFront = -0.12;
  c.beginPath();
  c.moveTo(X(-0.5, zBack), Y(zBack));
  c.lineTo(X(n - 0.5, zBack), Y(zBack));
  c.lineTo(X(n - 0.5, zFront), Y(zFront));
  c.lineTo(X(-0.5, zFront), Y(zFront));
  c.closePath();
  c.fillStyle = '#10142B';
  c.fill();
  c.strokeStyle = COLORS.target;
  c.lineWidth = 2;
  c.shadowColor = COLORS.target;
  c.shadowBlur = 14;
  c.stroke();
  c.shadowBlur = 0;

  // Lane dividers.
  c.strokeStyle = '#262B4D';
  c.lineWidth = 1;
  for (let i = 1; i < n; i++) {
    c.beginPath();
    c.moveTo(X(i - 0.5, zBack), Y(zBack));
    c.lineTo(X(i - 0.5, zFront), Y(zFront));
    c.stroke();
  }

  // Bar lines.
  for (const m of s.score.measures) {
    const z = zOf(m.start);
    if (z < zFront || z > zBack) continue;
    c.strokeStyle = 'rgba(168,176,214,0.25)';
    c.lineWidth = Math.max(1, 2 * scale(z));
    c.beginPath();
    c.moveTo(X(-0.5, z), Y(z));
    c.lineTo(X(n - 0.5, z), Y(z));
    c.stroke();
  }

  // Notes (far to near so near overlaps far).
  const notes = s.part.notes;
  const [ra, rb] = s.range ?? [0, notes.length - 1];
  const vis: number[] = [];
  for (let i = ra; i <= rb; i++) {
    const nn = notes[i];
    const z0 = zOf(nn.start);
    const z1 = zOf(nn.start + nn.dur);
    if (z1 < zFront || z0 > zBack) continue;
    vis.push(i);
  }
  vis.sort((a, b) => notes[b].start - notes[a].start);
  for (const i of vis) {
    const nn = notes[i];
    const lane = lanes.indexOf(nn.midi);
    if (lane < 0) continue;
    const z0 = Math.max(zFront, zOf(nn.start));
    const z1 = Math.min(zBack, zOf(nn.start + nn.dur));
    const inset = 0.38;
    const isNow = nn.start <= s.pos && s.pos < nn.start + nn.dur;
    const past = nn.start + nn.dur <= s.pos;
    const g = past ? s.live?.noteGrade(i) : undefined;
    const fill = isNow ? (s.live?.noteFill(i) ?? 0) : 0;
    c.beginPath();
    c.moveTo(X(lane - inset, z1), Y(z1));
    c.lineTo(X(lane + inset, z1), Y(z1));
    c.lineTo(X(lane + inset, z0), Y(z0));
    c.lineTo(X(lane - inset, z0), Y(z0));
    c.closePath();
    const col = past ? gradeColor(g) : isNow && fill > 0.4 ? COLORS.voice : COLORS.target;
    c.fillStyle = col;
    c.globalAlpha = past ? (g === 'miss' ? 0.35 : 0.6) : 1;
    c.fill();
    if (isNow) {
      // cheap glow: wide translucent stroke instead of shadowBlur (expensive on phones)
      c.globalAlpha = 0.35;
      c.strokeStyle = col;
      c.lineWidth = 10;
      c.stroke();
    }
    c.globalAlpha = 1;
    if (nn.lyric && !past) {
      const sz = Math.max(9, Math.round(14 * scale(z0)));
      c.font = `800 ${sz}px "Bricolage Grotesque", sans-serif`;
      c.textBaseline = 'bottom';
      c.fillStyle = '#0B0D1A';
      const tw = c.measureText(nn.lyric).width;
      const nx = X(lane, z0);
      const laneW = X(lane + inset, z0) - X(lane - inset, z0);
      if (tw < laneW + 4 && Y(z0) - Y(z1) > sz) c.fillText(nn.lyric, nx - tw / 2, Y(z0) - 3);
    }
  }

  // Strike line.
  c.fillStyle = COLORS.text;
  c.shadowColor = COLORS.text;
  c.shadowBlur = 18;
  c.fillRect(X(-0.5, 0), strikeY - 3, X(n - 0.5, 0) - X(-0.5, 0), 6);
  c.shadowBlur = 0;

  // Lane labels.
  if (s.showNames) {
    c.textBaseline = 'top';
    lanes.forEach((m, i) => {
      const lab = noteLabel(m, s.notation, s.key).text;
      const fs = n > 9 ? 11 : 14;
      c.font = `800 ${fs}px "Bricolage Grotesque", sans-serif`;
      const tw = c.measureText(lab).width;
      const active = vis.some((vi) => notes[vi].midi === m && notes[vi].start <= s.pos && s.pos < notes[vi].start + notes[vi].dur);
      c.fillStyle = active ? COLORS.voice : COLORS.label;
      c.fillText(lab, X(i, 0) - tw / 2, strikeY + 14);
    });
  }

  // Voice puck.
  const last = s.samples[s.samples.length - 1];
  if (last && last.midi != null && s.pos - last.time < 0.2) {
    const lp = laneOf(last.midi, lanes);
    const px = X(lp, 0);
    c.fillStyle = COLORS.voice;
    c.shadowColor = COLORS.voice;
    c.shadowBlur = 24;
    c.beginPath();
    c.arc(px, strikeY, 13, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#EEF0FF';
    c.beginPath();
    c.arc(px, strikeY, 4, 0, Math.PI * 2);
    c.fill();
    // trail
    for (let k = s.samples.length - 2, j = 0; k >= 0 && j < 14; k--, j++) {
      const sm = s.samples[k];
      if (sm.midi == null || s.pos - sm.time > 0.5) continue;
      const z = -(s.pos - sm.time) / ahead;
      c.globalAlpha = 0.5 * (1 - j / 14);
      c.beginPath();
      c.arc(X(laneOf(sm.midi, lanes), z), Y(z), 6, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Grade popups & sparks for newly finished notes.
  if (s.live) {
    for (let i = Math.max(ra, fx.lastGraded + 1); i <= rb; i++) {
      const g = s.live.noteGrade(i);
      if (!g) break;
      fx.lastGraded = i;
      fx.popups.push({ text: GRADE_TEXT[g], color: g === 'miss' ? COLORS.miss : g === 'ok' ? COLORS.label : COLORS.voice, born: now });
      if (!reduceMotion && (g === 'perfect' || g === 'good')) {
        const lane = Math.max(0, lanes.indexOf(notes[i].midi));
        const sx = X(lane, 0);
        for (let k = 0; k < (g === 'perfect' ? 14 : 7); k++) {
          const a = Math.random() * Math.PI;
          const v = 80 + Math.random() * 160;
          fx.sparks.push({ x: sx, y: strikeY, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, born: now, color: g === 'perfect' ? COLORS.voice : COLORS.target });
        }
      }
    }
  }
  fx.sparks = fx.sparks.filter((p) => now - p.born < 0.7);
  for (const p of fx.sparks) {
    const t = now - p.born;
    c.globalAlpha = 1 - t / 0.7;
    c.fillStyle = p.color;
    c.fillRect(p.x + p.vx * t, p.y + p.vy * t + 200 * t * t, 3, 3);
  }
  c.globalAlpha = 1;
  fx.popups = fx.popups.filter((p) => now - p.born < 0.8).slice(-1);
  for (const p of fx.popups) {
    const t = (now - p.born) / 0.8;
    c.globalAlpha = 1 - t;
    c.font = `italic 800 ${reduceMotion ? 36 : Math.round(36 + 8 * (1 - t))}px "Bricolage Grotesque", sans-serif`;
    c.textBaseline = 'middle';
    const tw = c.measureText(p.text).width;
    c.fillStyle = p.color;
    c.fillText(p.text, cx - tw / 2, H * 0.3 - (reduceMotion ? 0 : t * 20));
  }
  c.globalAlpha = 1;
}
