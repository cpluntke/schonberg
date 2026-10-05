import { useRef, useState, type MutableRefObject } from 'react';
import type { PracticeSession } from './session';
import { track } from '../../progress/metrics';

type Phase = 'ready' | 'running' | 'paused' | 'micError';

/**
 * Resume a paused run, switching the screen to 'running' only once playback has really started.
 * If the mic can't be reopened the mic-error overlay shows; if the sound doesn't start (call,
 * another app holding audio) the run stays paused with a "tap Resume to try again" note.
 */
export function useResume(
  sessionRef: MutableRefObject<PracticeSession | null>,
  setPhase: (p: Phase) => void,
  setMicMsg: (m: string) => void,
): { resume: () => Promise<void>; resuming: boolean; resumeMsg: string } {
  const [resuming, setResuming] = useState(false);
  const [resumeMsg, setResumeMsg] = useState('');
  const busy = useRef(false);
  async function resume() {
    const s = sessionRef.current;
    if (!s || busy.current) return;
    busy.current = true;
    setResuming(true);
    setResumeMsg('');
    try {
      const r = await s.resume();
      if (sessionRef.current !== s) return;
      if (r === 'ok') setPhase('running');
      else if (r === 'mic') {
        setMicMsg(s.micError ?? 'The microphone could not be reopened.');
        track('err.mic');
        setPhase('micError');
      } else if (r === 'audio') {
        setResumeMsg("The sound didn't start (a call or another app may be using audio). Tap Resume to try again.");
      }
    } catch (e) {
      console.error(e);
      if (sessionRef.current === s) setResumeMsg("The sound didn't start. Tap Resume to try again.");
    } finally {
      busy.current = false;
      setResuming(false);
    }
  }
  return { resume, resuming, resumeMsg };
}
