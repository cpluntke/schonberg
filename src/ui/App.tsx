import React, { useEffect } from 'react';
import { releaseTracker } from './play/session';
import { useRoute, go, type Route } from './router';
import { useLibrary } from './library';
import { useToast } from './hooks';
import { IconHome, IconMusic, IconRanks, IconSliders } from './icons';
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
import './generated';
import { Diagnostics } from './screens/Diagnostics';
import { LyricsQuiz } from './screens/LyricsQuiz';
import { MemoryMap } from './screens/MemoryMap';
import { ChoirScreen, ChoirAdmin, SectionLead, SuperAdmin } from './screens/Choir';
import { InviteScreen } from './screens/Invite';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UpdatePrompt } from './components/UpdatePrompt';
import { flushProgress, syncProgressSoon } from '../progress/sync';
import { loadSession, onSessionChange } from '../progress/choir';
import { shareMyProgress } from './play/shareProgress';

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
  // Release the microphone after a while away from the screens that use it (privacy + battery).
  // Not too eagerly: iOS may ask for permission again every time the mic is reopened, and singers
  // hop between Results, the piece and the next run.
  useEffect(() => {
    const micScreens = ['play', 'setup', 'tuner', 'diagnostics', 'results', 'piece'];
    if (micScreens.includes(route.name)) return;
    const t = window.setTimeout(() => releaseTracker(), 3 * 60_000);
    return () => clearTimeout(t);
  }, [route.name]);
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) releaseTracker();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  // Progress kept with the choir account: on start and whenever the app comes back, if something
  // changed (at most once a minute). A new login also moves this phone's shared progress to the account.
  useEffect(() => {
    syncProgressSoon();
    const onBack = () => { if (!document.hidden) syncProgressSoon(); else flushProgress(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    window.addEventListener('pagehide', flushProgress);
    let account = loadSession()?.account.id ?? '';
    const offSession = onSessionChange(() => {
      const id = loadSession()?.account.id ?? '';
      if (id && id !== account) void shareMyProgress(true);
      account = id;
    });
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
  const showNav = ['home', 'library', 'ranks', 'settings', 'piece', 'expert'].includes(route.name);

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
      case 'diagnostics': body = <Diagnostics />; break;
      case 'lyrics': body = <LyricsQuiz key={route.pieceId + route.partId} pieceId={route.pieceId} partId={route.partId} />; break;
      case 'memorymap': body = <MemoryMap key={route.pieceId + route.partId} pieceId={route.pieceId} partId={route.partId} />; break;
      case 'choir': body = <ChoirScreen />; break;
      case 'choiradmin': body = <ChoirAdmin />; break;
      case 'section': body = <SectionLead />; break;
      case 'superadmin': body = <SuperAdmin />; break;
      case 'invite': body = <InviteScreen key={route.token ?? 'invite'} token={route.token} />; break;
    }
  }

  return (
    <div className={route.name === 'play' ? 'app app-play' : 'app'}>
      <ErrorBoundary resetKey={JSON.stringify(route)}>{body}</ErrorBoundary>
      <UpdatePrompt hidden={route.name === 'play'} />
      {showNav && (
        <nav className="nav" aria-label="Main">
          <div className="nav-inner">
            {TABS.map((t) => (
              <button key={t.name} aria-current={route.name === t.name ? 'page' : undefined} onClick={() => go({ name: t.name } as Route)}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
