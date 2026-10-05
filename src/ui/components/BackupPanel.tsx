import React, { useEffect, useRef, useState } from 'react';
import { useProfile, useStoreVersion, toast } from '../hooks';
import { apiBase } from '../../progress/choir';
import { loadProfile } from '../../progress/store';
import { backupEnabled, backupKey, deleteBackup, loadMeta, restoreFromCode, uploadBackup } from '../../progress/backup';
import { encodeRestoreCode } from '../../progress/backupCode';
import { syncChoirNow } from '../library';

function ago(t: number): string {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Settings → "Your progress backup": the switch, the restore code, restoring on a new phone, deleting. */
export function BackupPanel() {
  const [profile, update] = useProfile();
  useStoreVersion();
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'sync' | 'restore' | 'delete'>('');
  const [restoreErr, setRestoreErr] = useState('');
  // Home's "New phone? Restore your progress" opens the restore form.
  const [openRestore] = useState(() => {
    try {
      const v = sessionStorage.getItem('sh:openRestore');
      sessionStorage.removeItem('sh:openRestore');
      return !!v;
    } catch { return false; }
  });
  const restoreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (openRestore) restoreRef.current?.scrollIntoView({ block: 'center' }); }, [openRestore]);
  if (!apiBase()) return null;
  const on = backupEnabled(profile);
  const meta = loadMeta();
  const key = backupKey();
  const restoreCode = key ? encodeRestoreCode(key) : null;

  async function syncNow() {
    setBusy('sync');
    const r = await uploadBackup(true);
    setBusy('');
    toast(r.ok ? 'Progress backed up' : `Not backed up: ${r.error}`);
  }

  return (
    <section className="col" style={{ gap: 8 }} data-testid="backup-panel">
      <h2 className="eyebrow">Your progress backup</h2>
      <label className="toggle-row">
        <span>Back up my progress to the choir server
          <span className="tiny muted" style={{ display: 'block' }}>Your levels, best results, practice dates and how each bar is going, plus your settings (a few KB). Never recordings.</span>
        </span>
        <input type="checkbox" checked={on} data-testid="backup-switch" onChange={(e) => {
          update({ backup: e.target.checked });
          if (e.target.checked) void syncNow();
        }} />
      </label>
      {!on && !profile.choirCode && (
        <span className="small muted">Recommended: if you lose or change your phone, the backup brings your progress back.</span>
      )}
      {on && (
        <span className="small muted" role="status" data-testid="backup-status">
          {busy === 'sync' ? 'Backing up…'
            : meta.error ? <span style={{ color: 'var(--accent-text)' }}>Not backed up yet: {meta.error}</span>
              : meta.savedAt ? `Backed up ${ago(meta.savedAt)}${meta.bytes ? ` · ${(meta.bytes / 1024).toFixed(1)} KB` : ''}. It updates after you practise.`
                : 'Backs up after your next run.'}
        </span>
      )}
      {on && (
        <div className="row wrap">
          <button className="btn small" disabled={!!busy} onClick={syncNow} data-testid="backup-now">Back up now</button>
          {restoreCode && meta.savedAt && (
            <button className="btn small" aria-expanded={showCode} onClick={() => setShowCode(!showCode)} data-testid="backup-show-code">
              {showCode ? 'Hide restore code' : 'Show restore code'}
            </button>
          )}
        </div>
      )}
      {showCode && restoreCode && (
        <div className="card flat" data-testid="backup-code-card">
          <span className="small">Your restore code. Keep it somewhere safe (a note, a photo): on a new phone it brings this progress back. Anyone with it can read or delete your backup.</span>
          <strong className="mono" style={{ fontSize: 18, letterSpacing: 1, wordBreak: 'break-word' }} data-testid="backup-code">{restoreCode}</strong>
          <button className="btn small" onClick={async () => {
            try {
              await navigator.clipboard.writeText(restoreCode);
              toast('Restore code copied');
            } catch {
              toast('Copy it by hand: select the code above');
            }
          }}>Copy</button>
        </div>
      )}
      <details data-testid="backup-restore" ref={restoreRef} open={openRestore || undefined}>
        <summary className="small">New phone? Restore from a code</summary>
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          <span className="small muted">Type the restore code from your old phone (Settings → Your progress backup). Progress already on this phone is kept: the higher level and the newer date win.</span>
          <label className="field"><span>Restore code</span>
            <input type="text" value={code} onChange={(e) => { setCode(e.target.value); setRestoreErr(''); }} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              autoCapitalize="characters" autoComplete="off" spellCheck={false} className="mono" data-testid="backup-code-input" />
          </label>
          {restoreErr && <span className="small" role="alert" style={{ color: 'var(--accent-text)' }}>{restoreErr}</span>}
          <button className="btn small" disabled={!code.trim() || !!busy} data-testid="backup-restore-btn" onClick={async () => {
            setBusy('restore');
            try {
              const r = await restoreFromCode(code);
              setCode('');
              toast(`Restored: progress on ${r.pieces} piece${r.pieces === 1 ? '' : 's'}`);
              if (loadProfile().choirCode) void syncChoirNow();
            } catch (e) {
              setRestoreErr((e as Error).message);
            } finally {
              setBusy('');
            }
          }}>{busy === 'restore' ? 'Restoring…' : 'Restore'}</button>
        </div>
      </details>
      {key && meta.savedAt && (
        <button className="btn small ghost" disabled={!!busy} data-testid="backup-delete" onClick={async () => {
          if (!confirm('Delete your progress backup from the server? Your progress on this phone stays, and backups turn off.')) return;
          setBusy('delete');
          try {
            await deleteBackup();
            setShowCode(false);
            toast('Backup deleted from the server');
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy('');
          }
        }}>Delete my backup</button>
      )}
    </section>
  );
}
