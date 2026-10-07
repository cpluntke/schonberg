// Who runs a choir: its admins and section leads (personal accounts), the open invite links, and the
// switch for the first version's shared passwords. Used by choir admins and by the super admin.

import React, { useEffect, useState } from 'react';
import { toast } from '../hooks';
import {
  createInvite, fetchPeople, inviteLink, rememberedInvite, removePerson, resetPerson, retireOldPasswords, revokeInvite, updatePerson, setSignupsOpen, removeMembersSince,
  type Account, type Auth, type InviteInfo, type People,
} from '../../progress/choir';

export const VOICES = ['S', 'A', 'T', 'B'] as const;
export const VOICE_NAME: Record<string, string> = { S: 'Sopranos', A: 'Altos', T: 'Tenors', B: 'Basses' };
const inputStyle: React.CSSProperties = { minHeight: 44, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', padding: '0 12px' };

export const voicesText = (vs: string[]) => vs.map((v) => VOICE_NAME[v] ?? v).join(', ');
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function roleText(role: string, voices: string[]): string {
  if (role === 'member') return 'Member (keeps their progress with the account)';
  return role === 'admin' ? 'Choir admin' : `Section lead${voices.length ? ` · ${voicesText(voices)}` : ''}`;
}

async function copy(text: string, field?: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / no permission: select the text and use the legacy command.
    try {
      if (field) { field.focus(); field.select(); }
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** A freshly made invite link: copy it or share it (WhatsApp, Signal, e-mail …). */
export function InviteLinkBox({ token, title, hint, onClose }: { token: string; title: string; hint?: string; onClose?: () => void }) {
  const url = inviteLink(token);
  const ref = React.useRef<HTMLInputElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="notice info col" data-testid="invite-link" style={{ gap: 8 }}>
      <strong>{title}</strong>
      <input ref={ref} type="text" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="mono"
        style={{ ...inputStyle, width: '100%', fontSize: 12 }} />
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn small primary" data-testid="copy-invite" onClick={async () => toast(await copy(url, ref.current) ? 'Link copied: paste it into a message' : 'Select the link and copy it')}>Copy link</button>
        {canShare && <button className="btn small" onClick={() => navigator.share({ title: 'Schönberg Hero invite', url }).catch(() => {})}>Share…</button>}
        {onClose && <button className="btn small ghost" onClick={onClose}>Done</button>}
      </div>
      <span className="tiny muted">{hint ?? 'Works once, for 7 days. Anyone with the link can use it, so send it only to that person.'}</span>
    </div>
  );
}

function inviteText(inv: InviteInfo): string {
  if (inv.reset) return `New password for ${inv.accountName ?? '?'}`;
  return `${inv.role === 'admin' ? 'Admin' : `Section lead · ${voicesText(inv.voices)}`}${inv.note ? ` · for ${inv.note}` : ''}`;
}

/** The "People" section: admins, section leads by voice, open invites. */
export function PeoplePanel({ code, auth, superAdmin = false, onChanged }: { code: string; auth: Auth; superAdmin?: boolean; onChanged?: () => void }) {
  const [people, setPeople] = useState<People | null>(null);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<{ token: string; title: string } | null>(null);
  const [leadVoice, setLeadVoice] = useState<string>('S');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState('');
  const load = () => fetchPeople(code, auth).then((p) => { setPeople(p); setErr(''); }).catch((e) => setErr((e as Error).message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [code]);
  const run = async (f: () => Promise<People | void>) => {
    setBusy(true);
    try {
      const p = await f();
      if (p) setPeople(p);
      else await load();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const invite = (role: 'admin' | 'lead') => run(async () => {
    const r = await createInvite(code, auth, role, role === 'lead' ? [leadVoice] : [], note.trim());
    const who = note.trim() ? ` for ${note.trim()}` : '';
    setFresh({ token: r.token, title: role === 'admin' ? `Invite link: admin${who}` : `Invite link: section lead for the ${VOICE_NAME[leadVoice]}${who}` });
    setNote('');
  });
  if (err && !people) return <div className="notice" role="alert">{err}</div>;
  if (!people) return <span className="muted small">Loading people…</span>;
  const admins = people.accounts.filter((a) => a.role === 'admin');
  const legacyLeads = VOICES.filter((v) => people.legacy.leads.includes(v));
  const leads = people.accounts.filter((a) => a.role === 'lead');
  const members = people.accounts.filter((a) => a.role === 'member');
  const person = (a: Account) => (
    <div key={a.id} className="col" style={{ gap: 4, padding: '6px 0', borderBottom: '1px solid var(--surface-2)' }} data-testid="person">
      <div className="row wrap" style={{ gap: 6 }}>
        {/* The buttons wrap below a name rather than squeeze it (a name breaks only if it's longer than the row). */}
        <span className="grow" style={{ flexBasis: '9em', overflowWrap: 'break-word' }}>
          <strong>{a.name}</strong>{a.id === people.you && <span className="tiny muted"> (you)</span>}
          <span className="tiny muted" style={{ display: 'block' }}>
            {a.lastLoginAt ? `last login ${day(a.lastLoginAt)}` : 'never logged in'}{a.invitedBy === 'old password' ? ' · joined with the old shared password' : ''}
          </span>
        </span>
        <button className="btn small ghost" disabled={busy} onClick={() => run(async () => {
          const r = await resetPerson(code, auth, a.id);
          setFresh({ token: r.token, title: `New-password link for ${a.name}` });
        })}>Reset password</button>
        {a.role === 'lead' && (
          <button className="btn small ghost" disabled={busy} onClick={() => {
            if (confirm(`Make ${a.name} a choir admin? Admins can change the programme, the scores and the people.`)) void run(() => updatePerson(code, auth, a.id, { role: 'admin' }));
          }}>Make admin</button>
        )}
        {a.id !== people.you && (
          <button className="btn small ghost danger" disabled={busy} onClick={() => {
            if (confirm(a.role === 'member'
              ? `Remove ${a.name}'s account? The progress kept with it and the progress they share with their section lead are deleted too.`
              : `Remove ${a.name}'s account? They can no longer log in.`)) void run(() => removePerson(code, auth, a.id));
          }}>Remove</button>
        )}
      </div>
      {a.role === 'lead' && (
        <div className="chips" role="group" aria-label={`${a.name} leads`}>
          {VOICES.map((v) => {
            const on = a.voices.includes(v);
            return (
              <button key={v} className="chip" aria-pressed={on} disabled={busy}
                onClick={() => {
                  if (on && a.voices.length === 1) { toast('A section lead needs at least one voice part: add the other one first'); return; }
                  void run(() => updatePerson(code, auth, a.id, { voices: on ? a.voices.filter((x) => x !== v) : [...a.voices, v] }));
                }}>
                {VOICE_NAME[v]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
  return (
    <div className="col" style={{ gap: 12 }} data-testid="people">
      {fresh && <InviteLinkBox token={fresh.token} title={fresh.title} onClose={() => setFresh(null)} />}
      {people.legacy.active && (
        <div className="notice col" style={{ gap: 6 }}>
          <span className="small">
            Not yet used: the old shared {people.legacy.admin ? 'admin password' : ''}{people.legacy.admin && legacyLeads.length ? ' and the ' : ''}
            {legacyLeads.length ? `section-lead password${legacyLeads.length > 1 ? 's' : ''} of the ${voicesText(legacyLeads)}` : ''}. Each works once, for one
            personal account{people.legacy.until ? `, until ${day(people.legacy.until)}` : ''}. Turn them off if nobody needs them any more.
          </span>
          <button className="btn small" disabled={busy} onClick={() => {
            if (confirm('Turn the old shared passwords off for good?')) void run(() => retireOldPasswords(code, auth));
          }}>Turn old passwords off</button>
        </div>
      )}
      <div className="col" style={{ gap: 2 }}>
        <span className="eyebrow">Admins</span>
        {admins.length ? admins.map(person) : <span className="small muted">No admin yet.</span>}
      </div>
      <div className="col" style={{ gap: 2 }}>
        <span className="eyebrow">Section leads</span>
        <div className="small" data-testid="leads-by-voice" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 2 }}>
          {VOICES.map((v) => (
            <React.Fragment key={v}>
              <span className="muted">{VOICE_NAME[v]}</span>
              <span style={{ overflowWrap: 'anywhere' }}>{leads.filter((a) => a.voices.includes(v)).map((a) => a.name).join(', ') || '–'}</span>
            </React.Fragment>
          ))}
        </div>
        {leads.map(person)}
      </div>
      <div className="col" style={{ gap: 2 }} data-testid="members">
        <span className="eyebrow">Members with an account ({members.length}{people.maxMembers ? ` of ${people.maxMembers}` : ''})</span>
        <span className="tiny muted" data-testid="members-note">
          Singers don't need an account: they join with the choir code, a first name and their voice part, and share
          their progress without one (Admin → Sections). An account is optional, for keeping progress on several phones.
        </span>
        <label className="toggle-row">
          <span>New member accounts<span className="tiny muted" style={{ display: 'block' }}>Singers make their own with the choir code to keep their progress on every phone.</span></span>
          <select aria-label="New member accounts" value={people.signupsOpen === false ? 'closed' : 'open'} disabled={busy} data-testid="signups-open"
            onChange={(e) => void run(() => setSignupsOpen(code, auth, e.target.value === 'open'))}
            style={{ minHeight: 44, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', padding: '0 8px' }}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        {members.length ? members.map(person) : <span className="small muted">None yet.</span>}
        {members.length > 0 && (
          <details>
            <summary className="small muted" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>Remove members who signed up since…</summary>
            <div className="row" style={{ gap: 6 }}>
              <input type="date" aria-label="Signed up since" value={since} onChange={(e) => setSince(e.target.value)} style={{ minHeight: 44, flex: 1 }} />
              <button className="btn small ghost danger" disabled={busy || !since} data-testid="remove-since" onClick={() => {
                const t = new Date(`${since}T00:00:00`).getTime();
                const names = members.filter((m) => (m.createdAt ?? 0) >= t).map((m) => m.name).sort((a, b) => a.localeCompare(b));
                const n = names.length;
                if (!n) { toast('Nobody signed up since then'); return; }
                const list = names.slice(0, 20).join(', ') + (n > 20 ? `, and ${n - 20} more` : '');
                if (confirm(`Remove ${n} member account${n === 1 ? '' : 's'} made since ${since}, with their progress?\n\n${list}`)) {
                  void run(async () => { const r = await removeMembersSince(code, auth, t); toast(`${r.removed} removed`); return r; });
                }
              }}>Remove</button>
            </div>
          </details>
        )}
      </div>
      {people.invites.length > 0 && (
        <div className="col" style={{ gap: 2 }}>
          <span className="eyebrow">Open invites</span>
          {people.invites.map((inv) => {
            const tok = rememberedInvite(inv.id);
            return (
              <div key={inv.id} className="row" style={{ gap: 6, padding: '4px 0' }} data-testid="pending-invite">
                <span className="grow small">{inviteText(inv)}
                  <span className="tiny muted" style={{ display: 'block' }}>by {inv.by || '?'} · until {day(inv.expiresAt)}{tok ? '' : ' · link on the phone that made it'}</span>
                </span>
                {tok && <button className="btn small ghost" onClick={async () => toast(await copy(inviteLink(tok)) ? 'Link copied' : 'Could not copy')}>Copy</button>}
                <button className="btn small ghost" disabled={busy} onClick={() => run(() => revokeInvite(code, auth, inv.id))}>Revoke</button>
              </div>
            );
          })}
        </div>
      )}
      <div className="col" style={{ gap: 8 }}>
        <span className="eyebrow">Invite someone</span>
        <label className="field"><span>Their name (only to recognise the invite)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="e.g. Maria" />
        </label>
        <div className="chips" role="group" aria-label="Voice part of the new section lead">
          {VOICES.map((v) => <button key={v} className="chip" aria-pressed={leadVoice === v} onClick={() => setLeadVoice(v)}>{VOICE_NAME[v]}</button>)}
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn small primary" disabled={busy} data-testid="invite-lead" onClick={() => invite('lead')}>Invite a lead for the {VOICE_NAME[leadVoice]}</button>
          <button className="btn small" disabled={busy} data-testid="invite-admin" onClick={() => invite('admin')}>Invite an admin</button>
        </div>
        <span className="tiny muted">
          {superAdmin ? 'The link lets them choose their name and password.' : 'You get a link to send them (WhatsApp, e-mail …); with it they choose their name and password.'} Admins run the programme, the scores and these people; section leads see how their section is doing.
        </span>
      </div>
    </div>
  );
}
