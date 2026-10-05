// A link to a piece or section that isn't here (an old bookmark, a deleted import, a choir piece
// this phone never received): say which, and offer Back and Home.
import React from 'react';
import { getPiece } from '../library';
import { attemptLog } from '../../progress/store';
import { back, go } from '../router';
import { IconBack } from '../icons';

/** Why `pieceId` (and its section) can't be opened here. */
export function missingText(pieceId: string, what: 'piece' | 'section' = 'section'): string {
  if (getPiece(pieceId)) return what === 'section' ? 'This section couldn\'t be found. The score may have changed since the link was made.' : 'This couldn\'t be found.';
  if (attemptLog().some((e) => e.pieceId === pieceId)) return 'This piece isn\'t on this device any more.';
  if (pieceId.startsWith('choir-')) return 'This choir piece isn\'t on this device. Your choir\'s pieces arrive here once you\'ve joined the choir and its programme includes them.';
  return 'This piece isn\'t on this device.';
}

export function NotFound({ pieceId, what, title = 'Not found', backLabel = 'Back' }: { pieceId: string; what?: 'piece' | 'section'; title?: string; backLabel?: string }) {
  return (
    <main className="screen" data-testid="not-found">
      <div className="topbar"><button className="icon-btn" aria-label={backLabel} onClick={() => back()}><IconBack /></button><h1>{title}</h1></div>
      <p className="muted">{missingText(pieceId, what)}</p>
      <button className="btn primary block" onClick={() => go({ name: 'home' }, true)}>Home</button>
    </main>
  );
}
