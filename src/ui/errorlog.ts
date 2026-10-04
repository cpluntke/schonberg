// A small persistent log of runtime errors, so field testers can send a diagnostics report.
const KEY = 'sh:errors';
const MAX = 30;

export interface ErrorEntry { at: number; msg: string; where: string }

export function logError(where: string, err: unknown) {
  try {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(0, 4).join('\n')}` : String(err);
    const list: ErrorEntry[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    list.push({ at: Date.now(), msg: msg.slice(0, 800), where });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function errorLog(): ErrorEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearErrorLog() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

let installed = false;
export function installGlobalErrorLogging() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => logError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
}
