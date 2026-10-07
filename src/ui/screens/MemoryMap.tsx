import React, { useEffect, useMemo, useState } from 'react';
import { getPiece, useLibrary } from '../library';
import { back, go } from '../router';
import { useProfile } from '../hooks';
import { IconBack } from '../icons';
import { buildMemoryMap, type MapEntry, type MapSection } from '../../game/memorymap';
import { nameKeysOf } from '../../progress/keymarks';
import { track } from '../../progress/metrics';
import { missingText } from '../components/NotFound';

// Scoped styles. Print: hide the app chrome (tab bar `nav.nav`, toasts / update prompt `.toast`,
// buttons marked .mm-noprint), switch the theme tokens to dark-on-white, keep cards whole.
const CSS = `
.mm { gap: 14px; }
.mm-summary { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 14px; }
.mm-summary b { font-weight: 800; }
.mm-sec { gap: 10px; }
.mm-sec-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.mm-sec-head h2 { font-size: 17px; }
.mm-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.mm-tag { font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: var(--surface-2); color: var(--text); }
.mm-tag.change { background: var(--expert-bg); color: var(--expert); border: 1px solid #3a3380; }
.mm-entries { display: flex; flex-direction: column; }
.mm-entry { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 2px 10px; padding: 7px 0; border-top: 1px solid var(--surface-2); }
.mm-entry:first-child { border-top: none; }
.mm-bar { font-family: var(--mono); font-size: 12px; line-height: 1.35; color: var(--muted); }
.mm-bar b { color: var(--text); font-size: 15px; display: block; }
.mm-what { font-size: 15px; overflow-wrap: anywhere; }
.mm-what .w { font-weight: 800; color: var(--accent-text); }
.mm-cue { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.mm-facts { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.mm-facts .k { font-weight: 700; }
.mm-text { font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
.mm-text.letters { font-family: var(--mono); font-size: 14px; letter-spacing: 0.03em; }
.mm-text .ln { display: block; }
.mm-text .ln .bn { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-right: 6px; }
.mm-rest { color: var(--muted); font-style: italic; }
@media print {
  :root {
    --bg: #fff; --bg-2: #fff; --surface: #fff; --surface-2: #ddd; --line: #999; --text: #000; --muted: #444;
    --accent-text: #000; --expert: #000; --expert-bg: #fff; --voice: #000; color-scheme: light;
  }
  html, body, #root, .app { background: #fff !important; color: #000 !important; }
  .app { max-width: none !important; padding: 0 !important; }
  nav.nav, .nav, .toast, .mm-noprint { display: none !important; }
  .screen.mm { padding: 0 !important; gap: 8px; }
  .mm .card { background: #fff !important; border: 1px solid #999 !important; border-radius: 6px; padding: 8px 10px; gap: 6px; break-inside: avoid; page-break-inside: avoid; }
  .mm .mm-tag { border: 1px solid #999; background: #fff !important; color: #000 !important; }
  .mm h1 { font-size: 18px !important; }
  .mm-entry { padding: 3px 0; }
  @page { margin: 12mm; }
}
`;

function Shell({ title, sub, onBack, actions, children }: { title: string; sub?: string; onBack: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="screen mm">
      <style>{CSS}</style>
      <div className="topbar">
        <button className="icon-btn mm-noprint" aria-label="Back to the piece" onClick={onBack}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <h1 className="ellipsis" style={{ margin: 0, fontSize: 22 }}>{title}</h1>
          {sub && <span className="small muted ellipsis">{sub}</span>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  );
}

function entryLine(e: MapEntry) {
  return (
    <div key={e.noteIndex} className="mm-entry">
      <span className="mm-bar"><b>{e.bar}</b>{e.beat}</span>
      <div className="col" style={{ gap: 1 }}>
        <span className="mm-what">
          {e.word ? <><span className="w">“{e.word}”</span> on </> : <>On </>}<strong>{e.note}</strong>
        </span>
        <span className="mm-cue">
          {e.cue ? `${e.cue.text[0].toUpperCase()}${e.cue.text.slice(1)}` : e.restBeats == null ? 'The first note of your part' : 'No other part just before: count the rest'}
        </span>
      </div>
    </div>
  );
}

function SectionCard({ s, letters }: { s: MapSection; letters: boolean }) {
  const real = s.lines.filter((l) => !l.vocalise);
  const vocalise = s.lines.length > 0 && real.length === 0;
  return (
    <section className="card mm-sec" aria-label={s.label}>
      <div className="mm-sec-head">
        <h2>{s.label}</h2>
        {s.label.toLowerCase() !== s.bars.toLowerCase() && <span className="small muted">{s.bars}</span>}
      </div>
      {s.changes.length > 0 && (
        <div className="mm-tags">
          {s.changes.map((c, i) => <span key={i} className="mm-tag change">bar {c.bar}: {c.text}</span>)}
        </div>
      )}
      {!s.sings ? (
        <span className="mm-rest">You rest ({s.endMeasure - s.startMeasure + 1} bars).</span>
      ) : (
        <>
          {s.entries.length > 0 && (
            <div className="mm-entries" aria-label="Entries">
              {s.entries.map(entryLine)}
            </div>
          )}
          <div className="mm-facts">
            {s.range && <span><span className="k">Range</span> {s.range.lowName === s.range.highName ? s.range.lowName : `${s.range.lowName}–${s.range.highName}`}</span>}
            {s.exposed.map((x) => (
              <span key={`e${x.from}`}><span className="k">Exposed</span> {x.bars}: {x.accompanied ? 'the only voice (instruments play)' : 'you sing alone'}</span>
            ))}
            {s.tune.map((x) => <span key={`t${x.from}`}><span className="k">You have the tune</span> {x.bars} (top voice)</span>)}
            {s.rests.map((x) => <span key={`r${x.from}`}><span className="k">Rest</span> {x.bars} ({x.length} bars)</span>)}
          </div>
          {real.length > 0 && (
            <div className={`mm-text${letters ? ' letters' : ''}`}>
              {real.map((l, i) => (
                <span key={i} className="ln"><span className="bn">{l.bar}</span>{letters ? l.letters : l.text}</span>
              ))}
            </div>
          )}
          {vocalise && <span className="small muted">No words here: you sing on “{s.lines[0].text.split(' ')[0].toLowerCase()}”.</span>}
        </>
      )}
    </section>
  );
}

export function MemoryMap({ pieceId, partId }: { pieceId: string; partId: string }) {
  useEffect(() => { track('feat.memorymap'); }, []);
  const lib = useLibrary();
  const [profile] = useProfile();
  const piece = getPiece(pieceId);
  const [letters, setLetters] = useState(true);
  const map = useMemo(
    () => (piece ? buildMemoryMap(piece.score, piece.sections, partId, { notation: profile.notation, nameKeys: nameKeysOf(piece.score) }) : null),
    [piece, partId, profile.notation],
  );
  const goBack = () => back({ name: 'piece', pieceId });

  if (!piece) {
    if (!lib.ready) return <Shell title="Memory map" onBack={goBack}><p className="muted" role="status">Loading the piece…</p></Shell>;
    return <Shell title="Not found" onBack={goBack}><p className="muted">{missingText(pieceId, 'piece')}</p>
      <button className="btn primary block" onClick={() => go({ name: 'home' }, true)}>Home</button></Shell>;
  }
  if (!map || !map.sections.length) {
    return <Shell title="Memory map" sub={piece.title} onBack={goBack}><p className="muted">This part has no notes to map. Go back and pick your part again.</p></Shell>;
  }

  const sub = `${piece.title} · ${map.partName}`;
  return (
    <Shell title="Memory map" sub={sub} onBack={goBack}
      actions={<button className="btn small mm-noprint" onClick={() => window.print()}>Print</button>}>
      <div className="card" style={{ gap: 8 }}>
        <span className="eyebrow">{piece.composer ? `${piece.composer} · ` : ''}{map.partName}</span>
        <div className="mm-summary">
          <span>Starts in <b>{map.start.key}</b></span>
          <span><b>{map.start.time}</b></span>
          <span><b>{map.start.tempo}</b></span>
          {map.range && <span>Range <b>{map.range.lowName}–{map.range.highName}</b></span>}
          <span><b>{map.entryCount}</b> {map.entryCount === 1 ? 'entry' : 'entries'}</span>
        </div>
        {map.usuallyTop && <span className="small muted">You're the top voice most of the time: you carry the tune.</span>}
        <span className="tiny muted">Entries: each note you sing after a rest of a beat or more, with the last note another part sings just before it.</span>
      </div>

      {map.hasText && (
        <div className="seg mm-noprint" role="group" aria-label="Text">
          <button aria-pressed={letters} onClick={() => setLetters(true)}>First letters</button>
          <button aria-pressed={!letters} onClick={() => setLetters(false)}>Full text</button>
        </div>
      )}

      {map.sections.map((s) => <SectionCard key={s.id} s={s} letters={letters} />)}
    </Shell>
  );
}
