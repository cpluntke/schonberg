import React, { useEffect, useState } from 'react';
import { toast } from '../hooks';
import { addLibraryPiece, fetchLibrary, type Auth, type ChoirInfo, type LibraryPiece } from '../../progress/choir';

/** The programme editor's unpublished changes: its piece ids (null when there are none) and how to add one. */
export interface ProgrammeDraft { ids: string[] | null; add: ((id: string) => void) | null }

const LEVEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/**
 * The choir library: public-domain scores kept on the server (not in the public app) that a choir
 * admin or the super admin adds to a choir with one tap. The server copies the score into the choir's
 * scores and puts it into the published programme; members get both with the next choir sync.
 */
export function LibraryPanel({ code, auth, info, draft, embedded = false, onAdded, onList }: {
  code: string; auth: Auth; info?: ChoirInfo | null; draft?: ProgrammeDraft; embedded?: boolean;
  onAdded?: (i: ChoirInfo | null) => void; onList?: (l: LibraryPiece[]) => void;
}) {
  const [list, setList] = useState<LibraryPiece[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
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
      const r = await addLibraryPiece(code, auth, p.id, toProgramme && !local);
      if (local && toProgramme) draft!.add!(p.id);
      setList((l) => l?.map((x) => (x.id === p.id ? { ...x, scoreId: r.piece.id, inProgramme: x.inProgramme || r.programme } : x)) ?? l);
      toast(local && toProgramme
        ? `“${p.title}” added to the choir's scores and to the programme above: publish it to send it to the choir`
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
        Public-domain pieces for choirs. Add to our choir copies the score into the choir's scores and puts it into the programme:
        members get it the next time they open the app. Only choir admins see this list.
      </span>
      {err && <div className="notice" role="alert">{err}</div>}
      {!list && !err && <span className="small muted">Loading…</span>}
      {list && (
        <div className="col" style={{ gap: 0 }}>
          {list.map((p) => {
            const inProgramme = draft?.ids ? draft.ids.includes(p.id) : p.inProgramme;
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
                      ✓ Added · in the programme{draft?.ids && !p.inProgramme ? ' (publish it above)' : ''}
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
