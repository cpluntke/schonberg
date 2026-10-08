import React, { useEffect } from 'react';
import { releaseTracker } from './play/session';
import { useRoute, go, type Route } from './router';
import { adoptLibraryIds, useLibrary } from './library';
import { upgradeAllFullRuns } from './plan';
import { subscribe } from '../progress/store';
import { useToast } from './hooks';
import { IconHome, IconMusic, IconRanks, IconShield, IconSliders } from './icons';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { PieceScreen } from './screens/Piece';
import { PlayScreen } from './screens/Play';
import { Results } from './screens/Results';
import { Setup } from './screens/Setup';
import { Settings } from './screens/Settings';
import { Ranks } from './screens/Ranks';
import { Expert } from './screens/Expert';
import { TunerScreen } from './screens/TunerScreen';
import { IntonationLab } from './screens/IntonationLab';
import './generated';
import { Diagnostics } from './screens/Diagnostics';
import { LyricsQuiz } from './screens/LyricsQuiz';
import { MemoryMap } from './screens/MemoryMap';
import { ChoirScreen } from './screens/Choir';
import { AdminScreen, ADMIN_ROUTES, adminHome, useStaff } from './screens/Admin';
import { InviteScreen } from './screens/Invite';
import { startUsageStats } from './usage';
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

const TABS: { name: Route['name']; label: string; icon: React.ReactNode }[] = [
  { name: 'home', label: 'Home', icon: <IconHome /> },
  { name: 'library', label: 'Library', icon: <IconMusic /> },
  { name: 'ranks', label: 'Ranks', icon: <IconRanks /> },
  { name: 'settings', label: 'Settings', icon: <IconSliders /> },
];

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
    // (the lab's ladder doesn't listen: only its steps do)
    if (micScreens.includes(route.name) && !(route.name === 'intonation' && !route.rung)) return;
    const t = window.setTimeout(() => releaseTracker(), 3 * 60_000);
    return () => clearTimeout(t);
  }, [route.name, route.name === 'intonation' && !!route.rung]);
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
      if (h) {
        h.setAttribute('tabindex', '-1');
        h.focus({ preventScroll: true });
        document.title = `${h.textContent?.trim() || 'Schönberg Hero'} · Schönberg Hero`;
      }
    }, 60);
    return () => clearTimeout(t);
  }, [route, lib.ready]);
  // The piece page belongs to the tab it was opened from (Home or Library): that tab stays lit.
  const [fromTab, setFromTab] = React.useState<Route['name']>(() => {
    try { return (sessionStorage.getItem('sh:fromTab') as Route['name'] | null) ?? 'library'; } catch { return 'library'; }
  });
  useEffect(() => {
    if (!TABS.some((t) => t.name === route.name)) return;
    setFromTab(route.name);
    try { sessionStorage.setItem('sh:fromTab', route.name); } catch { /* storage blocked */ }
  }, [route.name]);
  // Settings' own pages (the choir, the tuner, diagnostics) keep the sidebar on wide screens (no tab bar on phones).
  const settingsPage = ['choir', 'tuner', 'diagnostics'].includes(route.name);
  const tab = route.name === 'piece' ? fromTab : settingsPage ? 'settings' : route.name;
  const isAdmin = ADMIN_ROUTES.includes(route.name);
  const showNav = ['home', 'library', 'ranks', 'settings', 'piece', 'expert'].includes(route.name) || isAdmin;
  const sidebar = showNav || settingsPage;

  let body: React.ReactNode;
  if (!lib.ready && route.name !== 'setup' && route.name !== 'tuner') {
    body = <div className="screen" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="muted">Loading repertoire…</div></div>;
  } else {
    switch (route.name) {
      case 'home': body = <Home />; break;
      case 'library': body = <Library />; break;
      case 'piece': body = <PieceScreen key={route.pieceId} pieceId={route.pieceId} />; break;
      case 'play': body = <PlayScreen key={JSON.stringify(route)} route={route} />; break;
      case 'results': body = <Results />; break;
      case 'setup': body = <Setup />; break;
      case 'settings': body = <Settings />; break;
      case 'ranks': body = <Ranks />; break;
      case 'expert': body = <Expert />; break;
      case 'tuner': body = <TunerScreen />; break;
      case 'intonation': body = <IntonationLab key={`${route.interval ?? ''}${route.rung ?? ''}`} route={route} />; break;
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
      <ErrorBoundary resetKey={JSON.stringify(route)}>{body}</ErrorBoundary>
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
            {TABS.map((t) => (
              <button key={t.name} aria-current={tab === t.name ? (route.name === t.name ? 'page' : 'true') : undefined} onClick={() => go({ name: t.name } as Route)}>
                {t.icon}
                {t.label}
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
