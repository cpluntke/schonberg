// The Pieces tab (the UX review's D1; it replaces the Library): the programme's pieces from your
// choir with where each stands, the pieces still to come, your own imports, then importing. "Choose
// pieces" puts pieces into the programme or takes them out, and deletes your own imports.
import React, { useRef, useState } from 'react';
import { allPieces, addImported, removeImported, isOwnPiece, singableSections, useLibrary, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, toast } from '../hooks';
import { go } from '../router';
import { getProgress, loadCycle, saveCycle, fillWantedSlot, type WantedPiece } from '../../progress/store';
import { loadReached } from '../../progress/today';
import { importScoreFile } from '../../music/import';
import { IconCheck, IconChevron, IconClock, IconPlus, IconTrash } from '../icons';
import { track } from '../../progress/metrics';
import { cachedChoir, choirCycleNow } from '../../progress/choir';
import { meterNodes, pathStatus } from '../path';
import { LevelMeter } from '../components/LevelMeter';
import { YouButton } from '../components/YouSheet';
import { pieceStatus } from '../plan';
import { groupPieces, pieceRowStatus, readySince } from '../pieces';
import { dateWords } from '../today';
import { voiceName } from './Home';
import { useStaff } from './Admin';

const ACCEPT = '.musicxml,.xml,.mxl,.mid,.midi,application/vnd.recordare.musicxml+xml,audio/midi';

/** "7 Sep – 12 Dec" (a cycle's dates; either end may be missing). */
function span(start?: string, end?: string): string {
  const d = (x: string) => dateWords(x, { day: 'numeric', month: 'short' });
  return start && end ? `${d(start)} – ${d(end)}` : end ? `until ${d(end)}` : start ? `from ${d(start)}` : '';
}

export function Pieces() {
  const [profile] = useProfile();
  useStoreVersion();
  useLibrary();
  const staff = useStaff();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const cycle = loadCycle();
  const pieces = allPieces();
  const groups = groupPieces(pieces.map((p) => ({ ...p, own: isOwnPiece(p) })), cycle);
  const choir = profile.choirCode ? cachedChoir() : null;
  const fromChoir = !!choir && cycle.preset?.startsWith('choir:');
  const running = fromChoir ? choirCycleNow(choir) : null;
  const dates = span((running as { start?: string } | null)?.start, (running as { end?: string } | null)?.end ?? cycle.concertDate);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    for (const f of Array.from(files)) {
      try {
        const data = await f.arrayBuffer();
        const score = await importScoreFile(f.name, data);
        const singable = score.parts.filter((p) => p.notes.length > 0);
        if (!singable.length) throw new Error('No notes found in this file.');
        const p = await addImported(score);
        const slot = fillWantedSlot(p.id, p.title);
        toast(p.persisted
          ? `Imported “${p.title}” with ${singable.length} parts${slot ? ' and added it to this cycle' : ''}`
          : `Imported “${p.title}”, but this browser won't keep it after a reload (private mode or storage blocked).`);
        if (files.length === 1) go({ name: 'piece', pieceId: p.id });
      } catch (e) {
        console.error(e);
        track('err.import');
        const msg = (e as Error).message || '';
        const friendly = f.size === 0 ? 'the file is empty.'
          : /no notes/i.test(msg) ? 'no notes were found in it.'
            : /unsupported|extension/i.test(msg) ? 'this file type isn’t supported. Use MusicXML (.musicxml, .xml, .mxl) or MIDI (.mid).'
              : 'it doesn’t look like a valid MusicXML or MIDI file. Try exporting it again from your notation program.';
        setError(`${f.name}: ${friendly}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  const importButton = (label: string, cls: string) => (
    <button className={cls} disabled={busy} data-testid="import-score" onClick={() => fileRef.current?.click()}>
      <IconPlus size={18} /> {busy ? 'Importing…' : label}
    </button>
  );

  return (
    <main className="screen wide pieces">
      <div className="row between tab-head">
        <h1 className="hero">Pieces</h1>
        <YouButton />
      </div>
      <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} aria-label="Choose score files" />

      {choosing ? <ChoosePieces pieces={pieces} onDone={() => setChoosing(false)} /> : (
        <div className="lay pieces-cols">
          <section className="col pieces-main" style={{ gap: 10 }} aria-labelledby="pieces-programme">
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <h2 id="pieces-programme">{fromChoir ? 'From your choir' : 'Your programme'}</h2>
              <span className="t14 muted">{voiceName(profile.voice)} part</span>
            </div>
            {(cycle.name || dates) && <span className="t14 muted" style={{ marginTop: -6 }}>{[running?.name ?? cycle.name, dates].filter(Boolean).join(' · ')}</span>}
            {groups.programme.length > 0 ? (
              <div className="card piece-list">
                {groups.programme.map((p) => <PieceRow key={p.id} piece={p} voice={profile.voice} />)}
              </div>
            ) : (
              <div className="notice info" data-testid="pieces-empty">
                {fromChoir ? 'Your choir hasn’t put any scores in this programme yet.' : 'No pieces in your programme yet: import a score below, or choose from the pieces on this phone.'}
              </div>
            )}
            {groups.coming.map((w) => <Coming key={w.title} w={w} fromChoir={!!fromChoir} onImport={() => fileRef.current?.click()} />)}
            <button className="link start" data-testid="choose-pieces" onClick={() => setChoosing(true)}>Choose the programme’s pieces ›</button>
          </section>

          <div className="lay pieces-side">
            {groups.own.length > 0 && (
              <section className="col" style={{ gap: 10 }} aria-labelledby="pieces-own">
                <div className="row between" style={{ alignItems: 'baseline' }}>
                  <h2 id="pieces-own">Your own</h2>
                  <span className="t14 muted">only on this phone</span>
                </div>
                <div className="card piece-list">
                  {groups.own.map((p) => <PieceRow key={p.id} piece={p} voice={profile.voice} outside={!cycle.pieceIds.includes(p.id)} />)}
                </div>
              </section>
            )}

            {groups.more.length > 0 && (
              <section className="col" style={{ gap: 10 }} aria-labelledby="pieces-more">
                <h2 id="pieces-more">More on this phone</h2>
                <div className="card piece-list">
                  {groups.more.map((p) => <PieceRow key={p.id} piece={p} voice={profile.voice} outside />)}
                </div>
              </section>
            )}

            <section className="col" style={{ gap: 8 }} aria-label="Import a score">
              {importButton('Import a score (MusicXML)', 'btn block dashed')}
              <span className="t14 muted">
                MusicXML (.musicxml, .xml, .mxl) from MuseScore, Sibelius, Finale or Dorico works best: it keeps the parts and lyrics.
                MIDI (.mid) works too, without lyrics. Files stay on this device.
              </span>
              {error && <div className="notice" role="alert">{error}</div>}
              {staff.admin && (
                <button className="link start" onClick={() => go({ name: 'choiradmin' })} data-testid="pieces-choir-library">Add scores for the whole choir (Admin › Choir) ›</button>
              )}
            </section>
            <span className="t14 muted">Built in: an original warm-up chorale. {profile.choirCode
              ? 'Your choir’s scores, including public-domain pieces your choir admin adds from the choir library, arrive with the choir sync.'
              : 'Your choir’s scores, including public-domain pieces your choir admin adds from the choir library, arrive when you join your choir (the Choir tab).'}</span>
          </div>
        </div>
      )}
    </main>
  );
}

/** A piece: title, composer, the LevelMeter and where it stands; a tap opens it. */
function PieceRow({ piece, voice, outside = false }: { piece: PieceInfo; voice: string; outside?: boolean }) {
  const s = pieceStatus(piece, voice);
  const sections = singableSections(piece, s.partId);
  const prog = getProgress(piece.id, s.partId);
  const ps = pathStatus(sections, prog);
  const started = sections.some((x) => { const sp = prog?.sections[x.id]; return !!sp && (sp.level > 0 || (sp.slow ?? 0) > 0 || sp.attempts > 0); }) || !!prog?.full;
  const st = pieceRowStatus(ps, started, sections.length);
  const nodes = meterNodes({ level: ps.filled, slow: ps.half && ps.working ? ps.working.level : 0, now: started ? ps.working : null });
  const since = readySince(ps.pieceLevel, loadReached()[`${piece.id}|${s.partId}`], (t) => dateWords(t));
  const sub = [piece.composer, outside ? 'not in your programme' : ''].filter(Boolean).join(' · ');
  return (
    <button className="piece-row" data-testid="pieces-row" onClick={() => go({ name: 'piece', pieceId: piece.id })}>
      <span className="grow col" style={{ gap: 4, minWidth: 0 }}>
        <strong className="t16 title">{piece.title}</strong>
        {sub && <span className="t14 muted">{sub}</span>}
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <LevelMeter nodes={nodes} label={piece.title} />
          <span className={`t14 ${st.done ? 'good-text' : 'muted'}`} data-testid="pieces-status">{st.text}</span>
        </span>
        {since && <span className="t14 muted">{since}</span>}
      </span>
      <IconChevron size={20} color="var(--muted)" />
    </button>
  );
}

/** A programme piece without a score in the app yet. */
function Coming({ w, fromChoir, onImport }: { w: WantedPiece; fromChoir: boolean; onImport: () => void }) {
  return (
    <div className="card coming" data-testid="wanted-row">
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span style={{ color: 'var(--muted)', marginTop: 2 }}><IconClock /></span>
        <div className="grow col" style={{ gap: 2 }}>
          <strong className="t16">{w.title}</strong>
          <span className="t14 muted">
            {[w.composer, fromChoir ? 'coming: your choir hasn’t uploaded the score yet. It appears here when they do' : 'no score in the app yet'].filter(Boolean).join(' · ')}.
            {w.note ? ` ${w.note[0].toUpperCase()}${w.note.slice(1)}.` : ''}
          </span>
        </div>
      </div>
      <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={onImport}>Import your own copy</button>
    </div>
  );
}

/** Put pieces into the programme or take them out; delete your own imports. */
function ChoosePieces({ pieces, onDone }: { pieces: PieceInfo[]; onDone: () => void }) {
  const cycle = loadCycle();
  const fromChoir = cycle.preset?.startsWith('choir:');
  function toggle(id: string) {
    const c = loadCycle();
    c.pieceIds = c.pieceIds.includes(id) ? c.pieceIds.filter((x) => x !== id) : [...c.pieceIds, id];
    saveCycle(c);
  }
  return (
    <section className="col" style={{ gap: 8 }} data-testid="choose-list">
      <div className="row between">
        <h2>Choose the programme’s pieces</h2>
        <button className="btn small" onClick={onDone} data-testid="choose-done">Done</button>
      </div>
      <span className="t14 muted">
        Tick a piece to put it into your programme (Today plans with these).{fromChoir ? ' Your changes last until your choir publishes a new programme.' : ''}
      </span>
      <div className="lay lib-grid">
        {pieces.map((p) => {
          const inCycle = cycle.pieceIds.includes(p.id);
          return (
            <div key={p.id} className={inCycle ? 'list-row lib-piece in-cycle' : 'list-row lib-piece'}>
              <button className="mono-tile" aria-label={inCycle ? `Remove ${p.title} from cycle` : `Add ${p.title} to cycle`}
                aria-pressed={inCycle} onClick={() => toggle(p.id)}
                style={{ border: inCycle ? '2px solid var(--voice)' : '1px solid var(--line)', color: inCycle ? 'var(--voice)' : 'var(--muted)' }}>
                {inCycle ? <IconCheck size={20} /> : <IconPlus size={20} />}
              </button>
              <button className="grow col" style={{ gap: 2, background: 'none', border: 'none', textAlign: 'left', padding: 0, color: 'inherit', minHeight: 44 }}
                onClick={() => go({ name: 'piece', pieceId: p.id })}>
                <span className="ellipsis" style={{ fontWeight: 600, fontSize: '1rem' }}>{p.title}</span>
                <span className="t14 muted ellipsis">
                  {p.composer || 'Unknown composer'} · {p.score.parts.filter((x) => x.notes.length).length} parts · {p.score.measures.length} bars
                </span>
                {p.description && <span className="t14 muted">{p.description}</span>}
                {p.credit && <span className="t14 muted" style={{ opacity: 0.8 }}>{p.credit}</span>}
              </button>
              {p.level && <span className="badge muted">{p.level}</span>}
              {!p.builtin && (
                <button className="icon-btn" aria-label={`Delete ${p.title}`} onClick={async () => {
                  if (confirm(`Delete “${p.title}” from this device? Your practice history for it is kept.`)) await removeImported(p.id);
                }}><IconTrash size={18} /></button>
              )}
            </div>
          );
        })}
      </div>
      {!pieces.length && <span className="muted">No pieces yet.</span>}
    </section>
  );
}
