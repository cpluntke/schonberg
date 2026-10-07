import React, { useState } from 'react';
import { toast } from '../hooks';
import { apiBase, setChoirLogo, type Auth, type ChoirInfo } from '../../progress/choir';

const MAX_SIDE = 256; // px: Home shows it at 56 px, so this stays sharp on any phone
const MAX_BYTES = 95 * 1024; // the server takes 100 KB

/** A picture file scaled down to at most 256 px a side: PNG (keeps transparency), else WebP or JPEG to fit. */
export async function shrinkPicture(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('This browser cannot read the picture');
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const enc = (type: string, q?: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));
  for (const [type, q] of [['image/png'], ['image/webp', 0.9], ['image/webp', 0.75]] as [string, number?][]) {
    const b = await enc(type, q);
    if (b && b.type === type && b.size <= MAX_BYTES) return b;
  }
  // (no WebP encoder, e.g. older Safari: JPEG on white, which always fits at this size)
  const flat = document.createElement('canvas');
  flat.width = w;
  flat.height = h;
  const fg = flat.getContext('2d')!;
  fg.fillStyle = '#fff';
  fg.fillRect(0, 0, w, h);
  fg.drawImage(c, 0, 0);
  const jpg = await new Promise<Blob | null>((res) => flat.toBlob(res, 'image/jpeg', 0.85));
  if (!jpg || jpg.size > MAX_BYTES) throw new Error('The picture could not be made small enough');
  return jpg;
}

/** Admins: the choir's logo, shown to every singer of the choir on Home. */
export function ChoirLogoEditor({ code, auth, info, onChanged }: { code: string; auth: Auth; info: ChoirInfo | null; onChanged: (i: ChoirInfo) => void }) {
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const src = info?.logo && apiBase() ? `${apiBase()}/choirs/${encodeURIComponent(code)}/logo?v=${info.logo.updatedAt}` : null;
  const run = async (picture: Blob | null) => {
    setBusy(true);
    try {
      onChanged(await setChoirLogo(code, auth, picture));
      toast(picture ? 'Logo saved: singers see it on Home' : 'Logo removed');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setFileKey((k) => k + 1);
    }
  };
  return (
    <div className="card" data-testid="logo-editor">
      <strong>Choir logo</strong>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ width: 64, height: 64, borderRadius: 14, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
          {src ? <img src={src} alt={`${info?.name ?? 'Choir'} logo`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} data-testid="logo-preview" />
            : <span className="tiny muted">none</span>}
        </div>
        <span className="small muted grow">Shown on Home for everyone in the choir. A square picture works best (PNG, JPEG or WebP; the app makes it small).</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <label className={`btn small${busy ? ' disabled' : ''}`} style={{ cursor: busy ? 'default' : 'pointer' }}>
          {busy ? '…' : src ? 'Change the logo' : 'Choose a picture'}
          <input key={fileKey} type="file" accept="image/png,image/jpeg,image/webp,image/*" disabled={busy} hidden data-testid="logo-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { await run(await shrinkPicture(f)); } catch (err) { toast((err as Error).message || 'This picture could not be read'); setFileKey((k) => k + 1); }
            }} />
        </label>
        {src && <button className="btn small ghost" disabled={busy} data-testid="logo-remove"
          onClick={() => { if (confirm('Remove the choir logo?')) void run(null); }}>Remove</button>}
      </div>
    </div>
  );
}
