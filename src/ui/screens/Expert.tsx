import React, { useState } from 'react';
import { useProfile } from '../hooks';
import { go, back } from '../router';
import { getPiece, chosenPartId, registerVirtual, makePiece, type PieceInfo } from '../library';
import { loadCycle } from '../../progress/store';
import { rowOfTheDay, rowForms, rowToScore } from '../../game/twelvetone';
import { hardestIntervals } from '../../game/drills';
import { intervalName } from '../../game/notation';
import type { Score, ScoreNote, Measure, Part } from '../../music/types';
import { IconBack, IconPlay, IconCube } from '../icons';

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const sym = (p: number) => (p === 10 ? 't' : p === 11 ? 'e' : String(p));

const VOICE_RANGE: Record<string, [number, number]> = { S: [62, 77], A: [57, 72], T: [50, 65], B: [45, 60], other: [55, 70] };

function dayId(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Build a one-part drill score from (from, to) note pairs, one pair per bar. */
export function leapDrillScore(id: string, title: string, pairs: { a: number; b: number; label: string }[], bpm = 66): Score {
  const q = 60 / bpm;
  const notes: ScoreNote[] = [];
  const measures: Measure[] = [];
  pairs.forEach((p, i) => {
    const t0 = i * 4 * q;
    measures.push({ index: i, number: String(i + 1), startBeat: i * 4, durBeats: 4, start: t0, dur: 4 * q, timeSig: [4, 4] });
    notes.push({ midi: p.a, start: t0, dur: 1.5 * q, startBeat: i * 4, durBeats: 1.5, measure: i, lyric: p.label, syllabic: 'single' });
    notes.push({ midi: p.b, start: t0 + 1.5 * q, dur: 1.5 * q, startBeat: i * 4 + 1.5, durBeats: 1.5, measure: i, lyric: '↦', syllabic: 'single' });
  });
  const ms = notes.map((n) => n.midi);
  const part: Part = { id: 'drill', name: 'Leaps', voiceType: 'other', notes, low: Math.min(...ms), high: Math.max(...ms) };
  return {
    id, title, composer: 'From your repertoire', source: 'builtin', parts: [part], measures,
    keys: [{ beat: 0, time: 0, fifths: 0, mode: 'major' }], tempos: [{ beat: 0, time: 0, bpm }], duration: pairs.length * 4 * q,
  };
}

export function Expert() {
  const [profile] = useProfile();
  const row = rowOfTheDay(new Date());
  const allForms = rowForms(row);
  const forms: Record<string, number[]> = { P0: allForms.P0, R0: allForms.R0, I0: allForms.I0, RI0: allForms.RI0 };
  const [form, setForm] = useState<string>('P0');
  const [lo, hi] = profile.rangeLow && profile.rangeHigh && profile.rangeHigh - profile.rangeLow >= 12
    ? [profile.rangeLow + 2, profile.rangeHigh - 2] : VOICE_RANGE[profile.voice] ?? VOICE_RANGE.other;

  function playRow(level: number, mode: '2d' | '3d') {
    const chosen = forms[form] ?? row;
    const score = rowToScore(chosen, { low: lo, high: hi, seed: Number(dayId()) });
    score.id = `row-${dayId()}-${form}`;
    score.title = `Zwölfton ${form} · ${new Date().toLocaleDateString()}`;
    const p = makePiece(score, { builtin: true, title: score.title, composer: 'Row of the day' });
    registerVirtual(p);
    const part = score.parts[0];
    go({ name: 'play', pieceId: p.id, partId: part.id, sectionId: 'all', level, mode });
  }

  // Leap drill from the cycle's pieces.
  const cycle = loadCycle();
  const pieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  const leaps: { a: number; b: number; label: string; where: string }[] = [];
  for (const pc of pieces) {
    const part = pc.score.parts.find((x) => x.id === chosenPartId(pc, profile.voice));
    if (!part) continue;
    for (const h of hardestIntervals(part, 4)) {
      const a = part.notes[h.index - 1];
      const b = part.notes[h.index];
      if (!a || !b) continue;
      leaps.push({ a: a.midi, b: b.midi, label: `${h.semitones > 0 ? '↑' : '↓'}${intervalName(Math.abs(h.semitones))}`, where: `${pc.title}, bar ${pc.score.measures[h.measure]?.number ?? h.measure + 1}` });
    }
  }
  const drillPairs = leaps.slice(0, 12);

  function playLeaps(level: number, mode: '2d' | '3d') {
    const score = leapDrillScore(`leaps-${dayId()}`, 'Leap drill', drillPairs);
    const p = makePiece(score, { builtin: true, title: 'Leap drill', composer: 'Hardest intervals of your parts' });
    registerVirtual(p);
    go({ name: 'play', pieceId: p.id, partId: 'drill', sectionId: 'all', level, mode });
  }

  return (
    <main className="screen" style={{ background: '#0C0A1F' }}>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back()}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <h1 style={{ fontSize: 20 }}>Expert mode</h1>
          <span className="small" style={{ color: '#B8B0E0' }}>Atonal training: no key, no tonic to lean on</span>
        </div>
        <span className="badge expert">×3</span>
      </div>

      <section className="card expert">
        <div className="row between">
          <strong>Zwölfton of the day</strong>
          <span className="tiny" style={{ color: '#B8B0E0' }}>same row for the whole choir today</span>
        </div>
        <div className="seg" role="group" aria-label="Row form" style={{ background: '#221E4A' }}>
          {Object.keys(forms).map((f) => (
            <button key={f} aria-pressed={form === f} onClick={() => setForm(f)} style={form === f ? { background: '#B3A6FF' } : undefined}>{f}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 3 }}>
          {(forms[form] ?? row).map((pc, i) => (
            <div key={i} style={{ height: 48, borderRadius: 8, background: '#221E4A', color: '#D4CCFF', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{sym(pc)}</span>
              <span style={{ fontSize: 10 }}>{NAMES[pc]}</span>
            </div>
          ))}
        </div>
        <span className="small" style={{ color: '#D4CCFF' }}>P = prime, R = retrograde, I = inversion, RI = retrograde inversion. Set to your range ({lo}–{hi}).</span>
        <div className="row wrap">
          <button className="btn small" onClick={() => playRow(2, '2d')}>With guide tone</button>
          <button className="btn small" onClick={() => playRow(4, '2d')}>No help</button>
          <button className="btn small" onClick={() => playRow(3, '3d')}><IconCube size={16} color="#B3A6FF" /> Arcade</button>
        </div>
      </section>

      <section className="card expert">
        <strong>Leap drill from your repertoire</strong>
        {drillPairs.length ? (
          <>
            <span className="small" style={{ color: '#D4CCFF' }}>The {drillPairs.length} hardest intervals in your parts of this cycle, one per bar.</span>
            <div className="col" style={{ gap: 4 }}>
              {drillPairs.slice(0, 6).map((l, i) => (
                <div key={i} className="row small"><span className="mono" style={{ width: 52, color: '#B3A6FF' }}>{l.label}</span><span className="muted ellipsis">{l.where}</span></div>
              ))}
              {drillPairs.length > 6 && <span className="tiny muted">+ {drillPairs.length - 6} more</span>}
            </div>
            <div className="row wrap">
              <button className="btn small" onClick={() => playLeaps(1, '2d')}><IconPlay size={16} color="#EEF0FF" /> Slow, with guide</button>
              <button className="btn small" onClick={() => playLeaps(3, '2d')}>Without guide</button>
              <button className="btn small" onClick={() => playLeaps(3, '3d')}><IconCube size={16} color="#B3A6FF" /> Arcade</button>
            </div>
          </>
        ) : (
          <span className="small muted">Add pieces to your cycle to get leap drills.</span>
        )}
      </section>
    </main>
  );
}
