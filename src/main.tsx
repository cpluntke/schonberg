import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { installGlobalErrorLogging } from './ui/errorlog';
import { applyDisplay } from './ui/theme';
import { loadProfile } from './progress/store';

installGlobalErrorLogging();
// Settings → Display (colours, text size) before the first paint: no flash of the other theme.
try { applyDisplay(loadProfile()); } catch { /* storage blocked: the defaults */ }

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
