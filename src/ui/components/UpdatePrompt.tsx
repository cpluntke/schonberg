import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registers the service worker. When a new version is deployed, shows a small banner instead of
 * reloading on its own (an automatic reload in the middle of a practice run would lose it).
 * Hidden while singing.
 */
export function UpdatePrompt({ hidden }: { hidden: boolean }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Look for updates every hour while the app is open.
      if (reg) setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
    },
  });
  if (!needRefresh || hidden) return null;
  return (
    <div className="toast row" role="status" style={{ gap: 10 }}>
      <span>A new version is available.</span>
      <button className="btn small primary" onClick={() => updateServiceWorker(true)}>Update</button>
      <button className="btn small ghost" onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  );
}
