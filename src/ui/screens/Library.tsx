import React, { useRef, useState } from 'react';
import { allPieces, addImported, removeImported } from '../library';
import { useStoreVersion, toast } from '../hooks';
import { go } from '../router';
import { loadCycle, saveCycle } from '../../progress/store';
import { importScoreFile } from '../../music/import';
import { IconPlus, IconTrash, IconCheck } from '../icons';

export function Library() {
  useStoreVersion();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cycle = loadCycle();
  const pieces = allPieces();

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
        toast(`Imported “${p.title}” with ${singable.length} parts`);
        if (files.length === 1) go({ name: 'piece', pieceId: p.id });
      } catch (e) {
        console.error(e);
        setError(`${f.name}: ${(e as Error).message || 'could not read this file'}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function toggleCycle(id: string) {
    const c = loadCycle();
    c.pieceIds = c.pieceIds.includes(id) ? c.pieceIds.filter((x) => x !== id) : [...c.pieceIds, id];
    saveCycle(c);
  }

  return (
    <main className="screen">
      <div className="topbar"><h1>Library</h1></div>

      <div className="card">
        <strong>Import your choir's scores</strong>
        <span className="small muted">
          MusicXML (.musicxml, .xml, .mxl) from MuseScore, Sibelius, Finale or Dorico works best: it keeps the parts and lyrics.
          MIDI (.mid) works too, without lyrics. Files stay on this device.
        </span>
        <input ref={fileRef} type="file" multiple accept=".musicxml,.xml,.mxl,.mid,.midi,application/vnd.recordare.musicxml+xml,audio/midi"
          style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} aria-label="Choose score files" />
        <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconPlus size={18} color="#0B0D1A" /> {busy ? 'Importing…' : 'Import MusicXML or MIDI'}
        </button>
        {error && <div className="notice" role="alert">{error}</div>}
      </div>

      <section className="col" style={{ gap: 2 }}>
        <h2>All pieces</h2>
        <span className="small muted">Tick a piece to put it into this cycle (it then appears on Home).</span>
        {pieces.map((p) => {
          const inCycle = cycle.pieceIds.includes(p.id);
          return (
            <div key={p.id} className="list-row">
              <button className="mono-tile" aria-label={inCycle ? `Remove ${p.title} from cycle` : `Add ${p.title} to cycle`}
                aria-pressed={inCycle} onClick={() => toggleCycle(p.id)}
                style={{ border: inCycle ? '2px solid var(--voice)' : '1px solid var(--line)', color: inCycle ? 'var(--voice)' : 'var(--muted)' }}>
                {inCycle ? <IconCheck size={20} /> : <IconPlus size={20} />}
              </button>
              <button className="grow col" style={{ gap: 2, background: 'none', border: 'none', textAlign: 'left', padding: 0, color: 'inherit' }}
                onClick={() => go({ name: 'piece', pieceId: p.id })}>
                <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{p.title}</span>
                <span className="small muted ellipsis">
                  {p.composer || 'Unknown composer'} · {p.score.parts.filter((x) => x.notes.length).length} parts · {p.score.measures.length} bars
                </span>
                {p.description && <span className="tiny muted">{p.description}</span>}
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
        {!pieces.length && <span className="muted">No pieces yet.</span>}
      </section>
      <span className="tiny muted">Built-in pieces are original study pieces written for this app.</span>
    </main>
  );
}
