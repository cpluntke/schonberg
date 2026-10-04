// Standard MIDI File → Score.
// Header data (tempo map, time & key signatures, ppq) comes from @tonejs/midi; per-track raw events
// (needed to split by channel and to read lyric meta events) from `midi-file`, the parser @tonejs/midi uses.
import { Midi } from '@tonejs/midi';
import { parseMidi as parseSmf } from 'midi-file';
import type { KeySig, Measure, Part, Score, ScoreNote } from './types';
import { beatToTime, buildTempoMap } from './time';
import { guessVoiceType, hashString, voiceTypeFromName } from './musicxml';

interface RawMidiNote {
  tick: number;
  durTicks: number;
  midi: number;
}

function cleanLyric(t: string): { text: string; hyphen: boolean } | null {
  let s = t.replace(/[\r\n]/g, ' ').replace(/^[\\/]+/, '').trim();
  if (!s || s.startsWith('@')) return null; // karaoke header tags
  const hyphen = /-$/.test(s);
  s = s.replace(/-+$/, '').trim();
  if (!s) return null;
  return { text: s, hyphen };
}

export function parseMidi(data: ArrayBuffer | Uint8Array, opts?: { id?: string; title?: string }): Score {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const tone = new Midi(bytes);
  const smf = parseSmf(bytes);
  const ppq = tone.header.ppq || 480;

  // ---- tempo map
  const tempos = buildTempoMap(tone.header.tempos.map((t) => ({ beat: t.ticks / ppq, bpm: t.bpm })));

  // ---- collect notes per (track, channel) + lyrics per track
  type Group = { track: number; channel: number; name: string; program: number; notes: RawMidiNote[] };
  const groups: Group[] = [];
  const lyricsByTrack: { tick: number; text: string; hyphen: boolean }[][] = [];
  let endTick = 0;
  smf.tracks.forEach((events, ti) => {
    let tick = 0;
    let trackName = '';
    const open = new Map<string, { tick: number }[]>(); // `${ch}:${note}` → stack of note-ons (FIFO)
    const byCh = new Map<number, Group>();
    const programs = new Map<number, number>();
    const lyr: { tick: number; text: string; hyphen: boolean }[] = [];
    const txt: { tick: number; text: string; hyphen: boolean }[] = [];
    for (const ev of events) {
      tick += ev.deltaTime;
      endTick = Math.max(endTick, tick);
      const e = ev as unknown as { type: string; channel?: number; noteNumber?: number; velocity?: number; text?: string; programNumber?: number };
      if (e.type === 'trackName' && !trackName) trackName = e.text ?? '';
      else if (e.type === 'lyrics' || e.type === 'text') {
        const c = cleanLyric(e.text ?? '');
        if (c) (e.type === 'lyrics' ? lyr : txt).push({ tick, ...c });
      } else if (e.type === 'programChange') programs.set(e.channel ?? 0, e.programNumber ?? 0);
      else if (e.type === 'noteOn' && (e.velocity ?? 0) > 0) {
        const k = `${e.channel}:${e.noteNumber}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ tick });
      } else if (e.type === 'noteOff' || (e.type === 'noteOn' && (e.velocity ?? 0) === 0)) {
        const k = `${e.channel}:${e.noteNumber}`;
        const st = open.get(k)?.shift();
        if (!st) continue;
        const ch = e.channel ?? 0;
        if (ch === 9) continue; // GM drums
        let g = byCh.get(ch);
        if (!g) {
          g = { track: ti, channel: ch, name: trackName, program: programs.get(ch) ?? 0, notes: [] };
          byCh.set(ch, g);
        }
        g.notes.push({ tick: st.tick, durTicks: Math.max(1, tick - st.tick), midi: e.noteNumber ?? 60 });
      }
    }
    const chans = [...byCh.values()].filter((g) => g.notes.length);
    for (const g of chans) {
      g.name = trackName || '';
      if (chans.length > 1) g.name = `${trackName || 'Track ' + (ti + 1)} (ch ${g.channel + 1})`;
      groups.push(g);
    }
    // Karaoke files use text events for lyrics; prefer real lyric events.
    lyricsByTrack[ti] = lyr.length ? lyr : txt.length >= 8 ? txt : [];
  });
  // lyrics stored in a note-less track (e.g. track 0) apply to the first group when only one vocal line exists
  const orphanLyrics = lyricsByTrack.filter((l, ti) => l.length && !groups.some((g) => g.track === ti)).flat();

  // ---- measures
  const sigs = [...tone.header.timeSignatures].sort((a, b) => a.ticks - b.ticks);
  const endBeat = Math.max(endTick / ppq, ...groups.flatMap((g) => g.notes.map((n) => (n.tick + n.durTicks) / ppq)), 0);
  const measures: Measure[] = [];
  let beat = 0;
  let si = 0;
  let ts: [number, number] = sigs[0] && sigs[0].ticks === 0 ? [sigs[0].timeSignature[0], sigs[0].timeSignature[1]] : [4, 4];
  while (beat < endBeat - 1e-6 || measures.length === 0) {
    while (si < sigs.length && sigs[si].ticks / ppq <= beat + 1e-6) {
      ts = [sigs[si].timeSignature[0] || 4, sigs[si].timeSignature[1] || 4];
      si++;
    }
    let len = (ts[0] * 4) / ts[1];
    // a time-signature change in the middle of a bar ends the bar early
    if (si < sigs.length && sigs[si].ticks / ppq < beat + len - 1e-6) len = sigs[si].ticks / ppq - beat;
    const start = beatToTime(tempos, beat);
    measures.push({
      index: measures.length,
      number: String(measures.length + 1),
      startBeat: beat,
      durBeats: len,
      start,
      dur: beatToTime(tempos, beat + len) - start,
      timeSig: [ts[0], ts[1]],
    });
    beat += len;
    if (measures.length > 10000) break;
  }
  const measureOf = (b: number) => {
    let lo = 0;
    let hi = measures.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measures[mid].startBeat <= b + 1e-6) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // ---- keys (read raw: @tonejs/midi's own key decoding is off by 7)
  const keys: KeySig[] = [];
  const rawKeys: { tick: number; fifths: number; minor: boolean }[] = [];
  smf.tracks.forEach((events) => {
    let tick = 0;
    for (const ev of events) {
      tick += ev.deltaTime;
      const e = ev as unknown as { type: string; key?: number; scale?: number };
      if (e.type !== 'keySignature' || e.key === undefined) continue;
      let f = e.key;
      if (f > 7) f -= 14; // files written by @tonejs/midi store fifths + 14
      if (f >= -7 && f <= 7) rawKeys.push({ tick, fifths: f, minor: e.scale === 1 });
    }
  });
  rawKeys.sort((a, b) => a.tick - b.tick);
  for (const k of rawKeys) {
    const b = k.tick / ppq;
    if (keys.length && Math.abs(keys[keys.length - 1].beat - b) < 1e-6) keys.pop();
    keys.push({ beat: b, time: beatToTime(tempos, b), fifths: k.fifths, mode: k.minor ? 'minor' : 'major' });
  }
  if (!keys.length || keys[0].beat > 1e-6) keys.unshift({ beat: 0, time: 0, fifths: keys[0]?.fifths ?? 0, mode: keys[0]?.mode ?? 'major' });

  // ---- parts
  const parts: Part[] = groups.map((g, gi) => {
    g.notes.sort((a, b) => a.tick - b.tick || b.midi - a.midi);
    const lyr = lyricsByTrack[g.track]?.length ? lyricsByTrack[g.track] : groups.length === 1 || gi === 0 ? orphanLyrics : [];
    const tol = ppq / 8;
    let prevHyphen = false;
    let li = 0;
    const notes: ScoreNote[] = g.notes.map((n) => {
      const sb = n.tick / ppq;
      const db = n.durTicks / ppq;
      const start = beatToTime(tempos, sb);
      const sn: ScoreNote = { midi: n.midi, start, dur: beatToTime(tempos, sb + db) - start, startBeat: sb, durBeats: db, measure: measureOf(sb) };
      while (li < lyr.length && lyr[li].tick < n.tick - tol) li++;
      if (li < lyr.length && Math.abs(lyr[li].tick - n.tick) <= tol) {
        const l = lyr[li++];
        sn.lyric = l.text;
        sn.syllabic = prevHyphen ? (l.hyphen ? 'middle' : 'end') : l.hyphen ? 'begin' : 'single';
        prevHyphen = l.hyphen;
      }
      return sn;
    });
    const midis = notes.map((n) => n.midi);
    const name = g.name || `Track ${gi + 1}`;
    let vt = guessVoiceType(name, midis);
    // GM programs 0..7 pianos, 16..23 organs → accompaniment unless named as a voice
    const nameType = voiceTypeFromName(name);
    if (!nameType && ((g.program >= 0 && g.program <= 23 && g.program !== 0) || polyphonic(notes))) vt = 'other';
    return {
      id: `t${g.track}c${g.channel}`,
      name,
      voiceType: vt,
      notes,
      low: midis.length ? Math.min(...midis) : 0,
      high: midis.length ? Math.max(...midis) : 0,
    };
  });

  const title = opts?.title || tone.header.name || 'Untitled';
  const noteCount = parts.reduce((s, p) => s + p.notes.length, 0);
  const duration = Math.max(beatToTime(tempos, endBeat), ...parts.flatMap((p) => p.notes.map((n) => n.start + n.dur)), 0);
  return {
    id: opts?.id ?? 'midi-' + hashString(`${title}|${noteCount}|${endTick}`),
    title,
    composer: '',
    source: 'midi',
    parts,
    measures,
    keys,
    tempos,
    duration,
  };
}

/** True if more than 20% of notes overlap a previous note (chords → not a single vocal line). */
function polyphonic(notes: ScoreNote[]): boolean {
  if (notes.length < 2) return false;
  let overlaps = 0;
  let end = -Infinity;
  for (const n of notes) {
    if (n.startBeat < end - 0.05) overlaps++;
    end = Math.max(end, n.startBeat + n.durBeats);
  }
  return overlaps > notes.length * 0.2;
}
