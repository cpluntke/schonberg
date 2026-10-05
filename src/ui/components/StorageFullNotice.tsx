import React, { useEffect, useState } from 'react';
import { onStorageSaveFailed, storageSaveFailed } from '../../progress/store';
import { go } from '../router';

/**
 * Shown once, the first time progress can't be saved on this device (its storage is full, e.g.
 * shared with another site on the same domain). Non-blocking; waits until the singer isn't singing.
 */
export function StorageFullNotice({ hidden }: { hidden: boolean }) {
  const [failed, setFailed] = useState(storageSaveFailed);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => onStorageSaveFailed(() => setFailed(true)), []);
  if (!failed || dismissed || hidden) return null;
  return (
    <div className="toast" role="alert" data-testid="storage-full"
      style={{ bottom: 'auto', top: 'calc(12px + var(--safe-top))', display: 'flex', flexDirection: 'column', gap: 8, width: 'min(420px, 90vw)' }}>
      <span>
        <b>Progress can't be saved on this device: its storage is full.</b> It's kept until you close the app.
        To keep it, download a backup or log in to your choir account in Settings.
      </span>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small primary" onClick={() => { setDismissed(true); go({ name: 'settings' }); }}>Settings</button>
        <button className="btn small ghost" onClick={() => setDismissed(true)}>OK</button>
      </div>
    </div>
  );
}
