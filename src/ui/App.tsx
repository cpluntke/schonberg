import React, { useEffect } from 'react';
import { releaseTracker } from './play/session';
import { useRoute, go, type Route } from './router';
import { TAB_LABEL, TAB_NAMES, isFromScreen, isTab, lastTab, showsSidebar, showsTabBar, stampedTab, tabOf, type TabName } from './nav';
import { adoptLibraryIds, useLibrary } from './library';
import { upgradeAllFullRuns } from './plan';
import { subscribe } from '../progress/store';
import { useToast } from './hooks';
import { IconEar, IconMusic, IconPeople, IconShield, IconSun } from './icons';
import { Home } from './screens/Home';
import { Pieces } from './screens/Pieces';
import { AllCourses, DroneScreen, Train } from './screens/Train';
import { PieceScreen } from './screens/Piece';
import { PlayScreen } from './screens/Play';
import { Results } from './screens/Results';
import { Setup } from './screens/Setup';
import { Settings } from './screens/Settings';
import { Ranks } from './screens/Ranks';
import { Expert } from './screens/Expert';
import { TunerScreen } from './screens/TunerScreen';
import { IntonationLab } from './screens/IntonationLab';
import { ProgressScreen } from './screens/Progress';
import { SessionStrip } from './components/Today';
import './generated';
import { Diagnostics } from './screens/Diagnostics';
import { LyricsQuiz } from './screens/LyricsQuiz';
import { MemoryMap } from './screens/MemoryMap';
import { ChoirScreen } from './screens/Choir';
import { AdminScreen, ADMIN_ROUTES, adminHome, useStaff } from './screens/Admin';
import { InviteScreen } from './screens/Invite';
import { startUsageStats } from './usage';
import { startReminders } from '../progress/reminders';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UpdatePrompt } from './components/UpdatePrompt';
import { StorageFullNotice } from './components/StorageFullNotice';
import { flushProgress, onAccountConfirmed, syncProgressSoon } from '../progress/sync';
import { cachedChoir, choirLogo, ensureChoirSharing, refreshSuperSessionSoon } from '../progress/choir';
import { useProfile, useStoreVersion } from './hooks';
import { voiceName } from './screens/Home';
import { LOGO_TILE } from './components/ChoirLogo';
import { shareMyProgress } from './play/shareProgress';
import { retryPrivacyRemovals } from './play/privacy';
import { useDisplaySync } from './theme';

// Today · Pieces · Train · Choir (nav.ts: which screen lights which tab, where the tab bar shows).
const TAB_ICON: Record<TabName, React.ReactNode> = { home: <IconSun />, pieces: <IconMusic />, train: <IconEar />, choir: <IconPeople /> };

export function App() {
  const route = useRoute();
  const lib = useLibrary();
  const toast = useToast();
  const staff = useStaff();
  // Release the microphone after a while away from the screens that use it (privacy + battery).
  // Not too eagerly: iOS may ask for permission again every time the mic is reopened, and singers
  // hop between Results, the piece and the next run.
  useEffect(() => {
    const micScreens = ['play', 'setup', 'tuner', 'diagnostics', 'results', 'piece', 'intonation'];
    // (a course's page doesn't listen: only its steps and its quick check do)
    const labMic = route.name === 'intonation' && (!!route.rung || !!route.check);
    if (micScreens.includes(route.name) && !(route.name === 'intonation' && !labMic)) return;
    const t = window.setTimeout(() => releaseTracker(), 3 * 60_000);
    return () => clearTimeout(t);
  }, [route.name, route.name === 'intonation' && (!!route.rung || !!route.check)]);
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) releaseTracker();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  // Progress saved under the earlier level rules (docs/LEVELS.md): once the library is there, and
  // again whenever progress changes (e.g. pulled from another phone).
  useEffect(() => {
    if (!lib.ready) return;
    upgradeAllFullRuns();
    void adoptLibraryIds();
    let t = 0;
    // (also after an account copy arrives: it may hold progress under a choir score's old id)
    const off = subscribe(() => { clearTimeout(t); t = window.setTimeout(() => { upgradeAllFullRuns(); void adoptLibraryIds(); }, 500); });
    return () => { off(); clearTimeout(t); };
  }, [lib.ready, lib.version]);
  // Anonymous usage statistics (Settings → Send anonymous usage statistics): daily totals once a day, plus hourly counts every few minutes for the last 24 hours.
  useEffect(() => { startUsageStats(); }, []);
  // The daily practice reminder (if on): the server hears the subscription again, and "practised today" after a run.
  useEffect(() => startReminders(), []);
  // Progress kept with the choir account: on start and whenever the app comes back, if something
  // changed (at most once a minute). A new login also moves this phone's shared progress to the account.
  useEffect(() => {
    ensureChoirSharing();
    syncProgressSoon();
    void retryPrivacyRemovals(); // (a leaderboard exit or a sharing stop the server didn't confirm yet)
    // A super-admin login the server no longer accepts: its Admin tab goes (checked at most every 20 s).
    refreshSuperSessionSoon();
    const onBack = () => { if (!document.hidden) { syncProgressSoon(); refreshSuperSessionSoon(); void retryPrivacyRemovals(); } else flushProgress(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    window.addEventListener('pagehide', flushProgress);
    // Shared progress moves to the account only once this phone's progress is confirmed as the account's.
    const offSession = onAccountConfirmed(() => { void shareMyProgress(true); });
    return () => { document.removeEventListener('visibilitychange', onBack); window.removeEventListener('focus', onBack); window.removeEventListener('pagehide', flushProgress); offSession(); };
  }, []);
  // Accessibility: on every screen change, move focus to the screen's heading and update the title.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const h = document.querySelector('main h1') as HTMLElement | null;
      // (not away from a dialog the singer has already opened, e.g. a passage's sheet)
      const inDialog = !!document.activeElement?.closest?.('[role="dialog"]');
      if (h) {
        h.setAttribute('tabindex', '-1');
        if (!inDialog) h.focus({ preventScroll: true });
        document.title = `${h.textContent?.trim() || 'Schönberg Hero'} · Schönberg Hero`;
      }
    }, 60);
    return () => clearTimeout(t);
  }, [route, lib.ready]);
  // A piece (and Settings, Diagnostics) lights the tab it was opened from; opened straight from a
  // link, its own default (nav.ts). Remembered for the tab's session, so a reload keeps it.
  const [fromTab, setFromTab] = React.useState<TabName | null>(() => (isTab(route.name) ? route.name : lastTab()));
  useEffect(() => {
    if (!isTab(route.name)) return;
    setFromTab(route.name);
    try { sessionStorage.setItem('sh:fromTab', route.name); } catch { /* storage blocked */ }
  }, [route.name]);
  // Such a screen's history entry keeps the tab it was opened from (back and forward over several
  // tabs light the right one); stamped when the screen is entered.
  const stamped = isFromScreen(route.name) ? stampedTab() : null;
  useEffect(() => {
    if (!isFromScreen(route.name) || stampedTab() || !fromTab) return;
    try { history.replaceState({ ...((history.state as object | null) ?? {}), shTab: fromTab }, '', location.href); } catch { /* ignore */ }
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab = tabOf(route, stamped ?? fromTab);
  const isAdmin = ADMIN_ROUTES.includes(route.name);
  // Phones: the tab bar under the four tabs (and the staff screens); sub-screens have their back arrow.
  // Wide screens: the sidebar on sub-screens too; never while practising.
  const showNav = showsTabBar(route);
  const sidebar = showsSidebar(route);

  let body: React.ReactNode;
  if (!lib.ready && route.name !== 'setup' && route.name !== 'tuner') {
    body = <div className="screen" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="muted">Loading repertoire…</div></div>;
  } else {
    switch (route.name) {
      case 'home': body = <Home />; break;
      case 'pieces': body = <Pieces />; break;
      case 'train': body = <Train />; break;
      case 'piece': body = <PieceScreen key={route.pieceId} pieceId={route.pieceId} />; break;
      case 'play': body = <PlayScreen key={JSON.stringify(route)} route={route} />; break;
      case 'results': body = <Results />; break;
      case 'setup': body = <Setup />; break;
      case 'settings': body = <Settings />; break;
      case 'progress': body = <ProgressScreen />; break;
      case 'ranks': body = <Ranks />; break;
      case 'expert': body = <Expert />; break;
      case 'tuner': body = <TunerScreen />; break;
      case 'intonation': body = <IntonationLab key={`${route.interval ?? ''}${route.rung ?? ''}${route.done ? 'd' : ''}${route.check ? 'c' : ''}`} route={route} />; break;
      case 'courses': body = <AllCourses />; break;
      case 'drone': body = <DroneScreen />; break;
      case 'diagnostics': body = <Diagnostics />; break;
      case 'lyrics': body = <LyricsQuiz key={route.pieceId + route.partId} pieceId={route.pieceId} partId={route.partId} />; break;
      case 'memorymap': body = <MemoryMap key={route.pieceId + route.partId} pieceId={route.pieceId} partId={route.partId} />; break;
      case 'choir': body = <ChoirScreen />; break;
      case 'choiradmin':
      case 'section':
      case 'superadmin':
      case 'choirinsights':
      case 'usage': body = <AdminScreen route={route} />; break;
      case 'invite': body = <InviteScreen key={route.token ?? 'invite'} token={route.token} />; break;
    }
  }

  return (
    <div className={route.name === 'play' ? 'app app-play' : sidebar ? 'app has-nav' : 'app'}>
      {/* (keyboard: the menu comes after the page in the document; this jumps there first) */}
      {sidebar && <a href="#main-nav" className="skip-link" onClick={(e) => { e.preventDefault(); document.querySelector<HTMLElement>('#main-nav button')?.focus(); }}>Go to the menu</a>}
      {/* Today's session: the strip on top of the lab (Results and the pre-run card carry their own). */}
      {route.name === 'intonation' && (route.rung != null || route.check || route.done) && lib.ready && <SessionStrip lab />}
      <ErrorBoundary resetKey={JSON.stringify(route)}>{body}</ErrorBoundary>
      <DisplaySync />
      <UpdatePrompt hidden={route.name === 'play'} />
      <StorageFullNotice hidden={route.name === 'play'} />
      {sidebar && (
        <nav id="main-nav" className={showNav ? 'nav' : 'nav wide-only'} aria-label="Main">
          {/* (wide screens: the nav is a sidebar with the app's name on top and the choir below) */}
          <div className="nav-brand" aria-hidden="true">
            <span>Schönberg</span>
            <span className="badge">Hero</span>
          </div>
          <div className="nav-inner">
            {TAB_NAMES.map((t) => (
              <button key={t} data-testid={`tab-${t}`} aria-current={tab === t ? (route.name === t ? 'page' : 'true') : undefined} onClick={() => go({ name: t } as Route)}>
                {TAB_ICON[t]}
                {TAB_LABEL[t]}
              </button>
            ))}
            {/* Only with a staff login on this phone: "Section" for a section lead, else "Admin". */}
            {staff.label && (
              <button aria-current={isAdmin ? 'page' : undefined} data-testid="nav-admin" onClick={() => go(adminHome(staff))}>
                <IconShield />
                {staff.label}
              </button>
            )}
          </div>
          <NavChoir />
        </nav>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/** Settings → Display applied to the page (its own component: a profile change re-renders only it). */
function DisplaySync() {
  const [profile] = useProfile();
  useDisplaySync(profile);
  return null;
}

/** Wide screens: the choir (logo, name) and the singer's voice at the foot of the sidebar. Hidden on phones. */
function NavChoir() {
  const [profile] = useProfile();
  useStoreVersion();
  const choir = profile.choirCode ? cachedChoir() : null;
  if (!choir) return null;
  const logo = choirLogo();
  return (
    <div className="nav-choir">
      {logo && <img src={logo} alt={`${choir.name} logo`} data-testid="nav-choir-logo" style={{ background: LOGO_TILE }} />}
      <div className="col" style={{ gap: 0, minWidth: 0 }}>
        <span className="nav-choir-name">{choir.name}</span>
        <span className="tiny muted">{voiceName(profile.voice)}</span>
      </div>
    </div>
  );
}
