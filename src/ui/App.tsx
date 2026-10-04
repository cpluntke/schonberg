import React from 'react';
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
    }
  }

  return (
    <div className="app">
      {body}
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
