import React, { useEffect, useState } from 'react';
import { toast } from '../hooks';
import { addLibraryPiece, ChoirApiError, fetchCycles, fetchLibrary, setInProgramme, targetCycle, type Auth, type ChoirCycle, type ChoirInfo, type CyclesReply, type LibraryPiece } from '../../progress/choir';
import { LAB_ID, LAB_TITLE } from '../../game/intonation';

/** The programme editor's unpublished changes: its piece ids (null when there are none) and how to add one. */
export interface ProgrammeDraft { ids: string[] | null; add: ((id: string) => void) | null }

const LEVEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/**
 * The choir library: public-domain scores kept on the server (not in the public app) that a choir
 * admin or the super admin adds to a choir with one tap. The server copies the score into the choir's
 * scores and puts it into the programme of `cycle` (the one the admin is editing; without one, the
 * running cycle); members get both with the next choir sync.
 */
export function LibraryPanel({ code, auth, info, draft, cycle, embedded = false, onAdded, onList }: {
  code: string; auth: Auth; info?: ChoirInfo | null; draft?: ProgrammeDraft; cycle?: ChoirCycle | null; embedded?: boolean;
  onAdded?: (i: ChoirInfo | null) => void; onList?: (l: LibraryPiece[]) => void;
}) {
  const [list, setList] = useState<LibraryPiece[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // (an added piece can change the programme on the server: the lab's entry loads the cycles again)
  const [added, setAdded] = useState(0);
  const stamp = `${info?.updatedAt ?? 0}:${info?.cycleUpdatedAt ?? 0}`;
  useEffect(() => {
    let alive = true;
    fetchLibrary(code, auth)
      .then((r) => { if (alive) { setList(r.pieces); setErr(''); onList?.(r.pieces); } })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, stamp]);

  const add = async (p: LibraryPiece, toProgramme: boolean) => {
    // Unpublished programme changes on this screen: add the piece to them instead of publishing over them.
    const local = !!draft?.ids && !!draft.add;
    setBusy(p.id);
    try {
      const r = await addLibraryPiece(code, auth, p.id, toProgramme && !local, cycle?.id);
      if (local && toProgramme) draft!.add!(p.id);
      setList((l) => l?.map((x) => (x.id === p.id ? { ...x, scoreId: r.piece.id, inProgramme: x.inProgramme || r.programme } : x)) ?? l);
      setAdded((n) => n + 1);
      toast(local && toProgramme
        ? `“${p.title}” added to the choir's scores and to the programme above: publish it to send it to the choir`
        : toProgramme && !r.programme
          ? `“${p.title}” added to the choir's scores, but the programme is full: take a piece out of it to make room`
          : cycle
            ? `“${p.title}” added to the choir's scores${r.programme ? ` and to the programme of ${cycle.name}` : ''}`
            : `“${p.title}” added${r.programme ? ' to the programme' : ''}: members get it the next time they open the app`);
      onAdded?.(r.choir ?? null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <>
      <strong>Library</strong>
      <span className="small muted">
        Public-domain pieces for choirs. Add to our choir copies the score into the choir's scores and puts it into the programme
        {cycle ? <> of {cycle.name} (the cycle you're editing above)</> : <>: members get it the next time they open the app</>}. Only choir admins see this list.
      </span>
      <LabEntry code={code} auth={auth} draft={draft} cycle={cycle ?? null} stamp={`${stamp}:${added}`} onAdded={onAdded} />
      {err && <div className="notice" role="alert">{err}</div>}
      {!list && !err && <span className="small muted">Loading…</span>}
      {list && (
        <div className="col" style={{ gap: 0 }}>
          {list.map((p) => {
            // (in the cycle being edited: its unsaved programme, else its saved one)
            const saved = cycle ? cycle.pieceIds.includes(p.id) : p.inProgramme;
            const inProgramme = draft?.ids ? draft.ids.includes(p.id) : saved;
            return (
              <div key={p.id} className="col" data-testid="library-piece" data-piece={p.id}
                style={{ gap: 4, padding: '12px 0', borderTop: '1px solid var(--surface-2)' }}>
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <strong className="grow" style={{ fontSize: 15 }}>{p.title}</strong>
                  {p.level && <span className="badge muted">{LEVEL[p.level] ?? p.level}</span>}
                </div>
                <span className="small muted">{p.composer}</span>
                {p.description && <span className="small">{p.description}</span>}
                {p.credit && <span className="tiny muted">{p.credit}</span>}
                <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                  {!p.scoreId ? (
                    <>
                      <button className="btn small primary" disabled={busy != null} data-testid="library-add" onClick={() => add(p, true)}>
                        {busy === p.id ? 'Adding…' : 'Add to our choir'}
                      </button>
                      {inProgramme && <span className="small" style={{ color: 'var(--accent-text)' }}>In the programme, but members don't have the score yet</span>}
                    </>
                  ) : inProgramme ? (
                    <span className="small" data-testid="library-added" style={{ color: 'var(--voice)', fontWeight: 600 }}>
                      ✓ Added · in the programme{draft?.ids && !saved ? ' (publish it above)' : ''}
                    </span>
                  ) : (
                    <>
                      <span className="small" data-testid="library-added" style={{ color: 'var(--voice)', fontWeight: 600 }}>✓ Added to the scores</span>
                      <button className="btn small" disabled={busy != null} data-testid="library-programme" onClick={() => add(p, true)}>
                        {busy === p.id ? 'Adding…' : 'Put it in the programme'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {!list.length && <span className="small muted">The library is empty on this server.</span>}
        </div>
      )}
    </>
  );
  return embedded
    ? <div className="col" style={{ gap: 8 }} data-testid="library-panel">{body}</div>
    : <div className="card" data-testid="library-panel">{body}</div>;
}

/**
 * The intonation lab in the library: an exercise, not a score. With the cycle editor open above, it
 * goes into that programme (published with it); otherwise (the super admin's list, no cycle open) it
 * goes straight into the programme of the running cycle, else the next one. The choir's singers get
 * it while that cycle runs.
 */
function LabEntry({ code, auth, draft, cycle, stamp, onAdded }: {
  code: string; auth: Auth; draft?: ProgrammeDraft; cycle: ChoirCycle | null; stamp: string; onAdded?: (i: ChoirInfo | null) => void;
}) {
  const viaEditor = !!draft?.add && !!cycle;
  const [cycles, setCycles] = useState<CyclesReply | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (viaEditor) return;
    let alive = true;
    fetchCycles(code, auth).then((r) => { if (alive) { setCycles(r); setErr(''); } }).catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, viaEditor, stamp]);
  const target = viaEditor ? cycle : cycles ? targetCycle(cycles.cycles) : null;
  const saved = !!target?.pieceIds.includes(LAB_ID);
  const inProgramme = viaEditor && draft!.ids ? draft!.ids.includes(LAB_ID) : saved;
  const direct = async (on: boolean) => {
    if (!cycles || !target) return;
    setBusy(true);
    try {
      const r = await setInProgramme(code, auth, target, LAB_ID, on, cycles.cycleUpdatedAt);
      setCycles(r);
      const now = r.cycles.find((c) => c.id === target.id);
      toast(on && !now?.pieceIds.includes(LAB_ID) ? `The programme of ${target.name} is full: take a piece out of it to make room`
        : on ? `${LAB_TITLE} put in the programme of ${target.name}: the choir's singers get it while that cycle runs`
          : `${LAB_TITLE} taken out of the programme of ${target.name}`);
      onAdded?.(r.choir ?? null);
    } catch (e) {
      toast(e instanceof ChoirApiError && e.status === 409 ? 'The cycles changed meanwhile: they are loaded again, try once more' : (e as Error).message);
      // (another admin changed the cycles: load them again)
      fetchCycles(code, auth).then(setCycles).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" data-testid="library-lab" style={{ gap: 4, padding: '12px 0', borderTop: '1px solid var(--surface-2)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <strong className="grow" style={{ fontSize: 15 }}>{LAB_TITLE}</strong>
        <span className="badge muted">Exercise</span>
      </div>
      <span className="small">Find the pure fifth and the pure major third by ear: listen, tune by hand, sing with and without help, then in a chord. No score needed.</span>
      {err && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>{err}</span>}
      <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
        {viaEditor ? (
          inProgramme ? (
            <span className="small" data-testid="library-lab-in" style={{ color: 'var(--voice)', fontWeight: 600 }}>
              ✓ In the programme{draft!.ids && !saved ? ' (publish it above)' : ''}
            </span>
          ) : (
            <button className="btn small primary" data-testid="library-lab-add" onClick={() => {
              draft!.add!(LAB_ID);
              toast(`${LAB_TITLE} added to the programme of ${cycle!.name} above: publish it to send it to the choir`);
            }}>Put it in the programme</button>
          )
        ) : !cycles && !err ? (
          <span className="small muted">Loading…</span>
        ) : !cycles ? null : !target ? (
          <span className="small muted">This choir has no running or coming cycle: start one to give it the lab.</span>
        ) : inProgramme ? (
          <>
            <span className="small" data-testid="library-lab-in" style={{ color: 'var(--voice)', fontWeight: 600 }}>✓ In the programme of {target.name}</span>
            <button className="btn small ghost" disabled={busy} data-testid="library-lab-remove" onClick={() => void direct(false)}>Take it out</button>
          </>
        ) : (
          <button className="btn small primary" disabled={busy} data-testid="library-lab-add" onClick={() => void direct(true)}>
            {busy ? 'Adding…' : `Put it in the programme of ${target.name}`}
          </button>
        )}
      </div>
    </div>
  );
}
