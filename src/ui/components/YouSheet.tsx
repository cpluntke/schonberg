// "You": the round avatar at the top right of every tab (Today, Pieces, Intonation, Train, Choir) and the sheet
// it opens (the UX review's A7). Who you are, whether your progress is safe, and one row per part of
// Settings; each row opens Settings on that part (openAt), or its own screen. Staff rows only for
// staff logins. Settings itself stays a screen ("All settings").
import React, { useEffect, useRef, useState } from 'react';
import { APPEARANCES, TEXT_SIZES, textSizeOf } from '../theme';
import { go, openAt, type Route } from '../router';
import { useProfile, useStoreVersion } from '../hooks';
import { avatarInitials } from '../nav';
import { voiceName } from '../screens/Home';
import { adminRoute, useStaff } from '../screens/Admin';
import { apiBase, cachedChoir, loadSession } from '../../progress/choir';
import { loadMeta, syncEnabled } from '../../progress/sync';
import { weekGoalOf } from '../today';
import { loadReminder } from '../../progress/reminders';
import { letterName } from './Tuner';
import {
  IconChart, IconChevron, IconClose, IconData, IconHelp, IconLock, IconPeople, IconShield, IconText, IconTimer, IconUser,
} from '../icons';

type SheetState = { youSheet?: boolean } | null;
const sheetEntry = (): boolean => {
  try { return !!(history.state as SheetState)?.youSheet; } catch { return false; }
};

/**
 * The avatar button; opens the You sheet. The open sheet is a history entry (as the passage sheet
 * on a piece): the browser's and Android's back close it instead of leaving the screen.
 */
export function YouButton() {
  const [profile] = useProfile();
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const ini = avatarInitials(profile.name, profile.voice);
  // A sheet's entry left over from before a reload (the sheet is closed now): step down onto the
  // screen's own entry, so back doesn't land on the same screen again.
  useEffect(() => {
    if (!sheetEntry()) return;
    try {
      history.replaceState({ ...(history.state as object), youSheet: undefined }, '', location.href);
      if (history.length > 1) history.back();
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      setOpen(false);
      const then = pending.current;
      pending.current = null;
      then?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);
  const show = () => {
    try { history.pushState({ ...((history.state as object | null) ?? {}), youSheet: true }, '', location.href); } catch { /* ignore */ }
    setOpen(true);
  };
  /** Close the sheet (stepping back over its entry), then do `then` (e.g. open another screen). */
  const close = (then?: () => void) => {
    if (sheetEntry()) {
      pending.current = then ?? null;
      history.back();
    } else {
      setOpen(false);
      then?.();
    }
  };
  return (
    <>
      <button className="avatar-btn" aria-label={`You (${ini}): your voice, settings and account`} aria-haspopup="dialog" aria-expanded={open}
        data-testid="you-button" onClick={show}>
        {ini}
      </button>
      {open && <YouSheet onClose={close} />}
    </>
  );
}

interface Row { id: string; icon: React.ReactNode; title: string; sub: string; open: () => void }

export function YouSheet({ onClose }: { onClose: (then?: () => void) => void }) {
  const [profile] = useProfile();
  useStoreVersion();
  const staff = useStaff();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      // Keep keyboard focus inside the sheet.
      if (e.key === 'Tab' && sheetRef.current) {
        const f = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href]')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      // (back to the avatar, unless a row took the singer to another screen)
      if (prev?.isConnected) prev.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choir = profile.choirCode ? cachedChoir() : null;
  const choirName = choir && choir.code === profile.choirCode ? choir.name : profile.choirCode ? profile.choirCode : '';
  const settingsAt = (id: string) => () => onClose(() => openAt({ name: 'settings' }, id));
  const to = (r: Route) => () => onClose(() => go(r));
  const range = profile.rangeLow != null && profile.rangeHigh != null ? `range ${letterName(profile.rangeLow)}–${letterName(profile.rangeHigh)}` : 'range not measured yet';
  const goal = weekGoalOf(profile.weekGoal);
  const session = loadSession();
  const saved = !!session && syncEnabled(profile) && !!loadMeta().savedAt;
  const reminder = loadReminder();

  const rows: Row[] = [
    { id: 'voice', icon: <IconUser />, title: 'You & voice', sub: `${voiceName(profile.voice)} · ${range} · voice setup`, open: settingsAt('settings-voice') },
    { id: 'practice', icon: <IconTimer />, title: 'Practice', sub: `${goal} day${goal === 1 ? '' : 's'} a week · ${reminder.on ? `reminder ${reminder.time}` : 'no reminder'} · note names · strictness`, open: settingsAt('settings-practice') },
    { id: 'progress', icon: <IconChart />, title: 'Your progress', sub: 'Weeks, levels, getting better', open: to({ name: 'progress' }) },
    {
      id: 'choir', icon: <IconPeople />, title: 'Choir & account',
      sub: [choirName || 'No choir yet', apiBase() ? (session ? 'signed in' : 'account') : '', choirName ? 'change choir' : 'join'].filter(Boolean).join(' · '),
      open: settingsAt('settings-choir'),
    },
    { id: 'display', icon: <IconText />, title: 'Display', sub: `${APPEARANCES.find((a) => a.id === (profile.appearance ?? 'dark'))?.label} · ${TEXT_SIZES.find((t) => t.id === textSizeOf(profile.textSize))?.label.toLowerCase()} text · ${profile.display === 'highway' ? 'highway' : 'score'}`, open: settingsAt('settings-display-block') },
    { id: 'privacy', icon: <IconLock />, title: 'Privacy', sub: profile.choirCode ? 'What your choir sees of your practice' : 'Anonymous usage statistics', open: settingsAt('settings-privacy') },
    { id: 'help', icon: <IconHelp />, title: 'Help & intro video', sub: 'Watch the 2½-min intro · problem report', open: settingsAt('settings-help') },
    { id: 'data', icon: <IconData />, title: 'Your data', sub: 'Save a copy · restore it', open: settingsAt('settings-data') },
  ];
  // Staff logins on this phone only (members and singers without an account never see these).
  const staffRows: Row[] = [
    ...(staff.admin ? [{ id: 'admin', icon: <IconShield />, title: 'Choir admin', sub: 'Programme, scores, people', open: to(adminRoute('choir', staff)) }] : []),
    ...(staff.admin || staff.lead ? [{ id: 'sections', icon: <IconShield />, title: staff.admin ? 'Sections' : 'Your section', sub: 'Progress, hard bars, voice ranges', open: to(adminRoute('sections', staff)) }] : []),
    ...(staff.superAdmin ? [{ id: 'super', icon: <IconShield />, title: 'Super admin', sub: 'Choirs on this server, usage', open: to({ name: 'superadmin' }) }] : []),
  ];

  return (
    <div className="psheet-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="you-sheet-scrim">
      <div ref={sheetRef} className="psheet you-sheet" role="dialog" aria-modal="true" aria-labelledby="you-sheet-name" data-testid="you-sheet">
        <span className="grab" aria-hidden="true" />
        <div className="row" style={{ gap: 12 }}>
          <span className="avatar-btn big" aria-hidden="true">{avatarInitials(profile.name, profile.voice)}</span>
          <div className="grow col" style={{ gap: 2 }}>
            <h2 id="you-sheet-name" className="ellipsis">{profile.name.trim() || 'You'}</h2>
            <span className="t14 muted ellipsis">{[voiceName(profile.voice), choirName].filter(Boolean).join(' · ')}</span>
          </div>
          <button ref={closeRef} className="icon-btn filled" aria-label="Close" data-testid="you-close" onClick={() => onClose()}><IconClose /></button>
        </div>

        {saved ? (
          <div className="you-saved" data-testid="you-saved">
            <span className="tick" aria-hidden="true">✓</span>
            <span className="col" style={{ gap: 0 }}>
              <strong className="t14">Progress saved to your choir account</strong>
              <span className="t14 muted">On a new phone, sign in and it's all back.</span>
            </span>
          </div>
        ) : (
          <button className="you-unsaved" data-testid="you-unsaved" onClick={settingsAt(profile.choirCode && apiBase() ? 'account' : 'settings-data')}>
            <span className="t14 muted">Your progress is only on this phone. {profile.choirCode && apiBase() ? 'Keep it with a choir account' : 'Save a copy now and then'} ›</span>
          </button>
        )}

        <nav aria-label="You" className="you-rows">
          {[...rows, ...staffRows].map((r) => (
            <button key={r.id} className="you-row" data-testid={`you-row-${r.id}`} onClick={r.open}>
              <span className="you-ic" aria-hidden="true">{r.icon}</span>
              <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                <strong className="t16">{r.title}</strong>
                <span className="t14 muted">{r.sub}</span>
              </span>
              <IconChevron size={18} color="var(--muted)" />
            </button>
          ))}
        </nav>
        <button className="link" data-testid="you-all-settings" onClick={to({ name: 'settings' })}>All settings</button>
      </div>
    </div>
  );
}
