// Dev page (/pitch-test.html): start the PitchTracker and dump readings as JSON lines.
import { getAudioContext, unlockAudio } from '../audio/context';
import { MicError, PitchTracker } from '../audio/pitch';
import { playTone } from '../audio/player';

const $ = (id: string) => document.getElementById(id)!;
const out = $('out');
const status = $('status');
const now = $('now');
let tracker: PitchTracker | null = null;
const lines: string[] = [];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

$('start').addEventListener('click', async () => {
  if (tracker) return;
  try {
    await unlockAudio();
    const ctx = getAudioContext();
    tracker = await PitchTracker.create(ctx);
    status.textContent = `running @ ${ctx.sampleRate} Hz`;
    tracker.onPitch((p) => {
      const rec = {
        t: +p.ctxTime.toFixed(3),
        hz: p.hz == null ? null : +p.hz.toFixed(2),
        midi: p.midi == null ? null : +p.midi.toFixed(3),
        clarity: +p.clarity.toFixed(3),
        rms: +p.rms.toFixed(4),
      };
      lines.push(JSON.stringify(rec));
      if (lines.length > 400) lines.splice(0, lines.length - 400);
      out.textContent = lines.join('\n');
      if (p.midi != null) {
        const r = Math.round(p.midi);
        const cents = Math.round((p.midi - r) * 100);
        now.textContent = `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1} ${cents >= 0 ? '+' : ''}${cents}¢`;
      } else now.textContent = '–';
    });
  } catch (e) {
    status.textContent = e instanceof MicError ? `mic error: ${e.code}` : `error: ${(e as Error).message}`;
  }
});

$('stop').addEventListener('click', () => {
  tracker?.stop();
  tracker = null;
  status.textContent = 'stopped';
});

$('tone').addEventListener('click', async () => {
  await unlockAudio();
  playTone(getAudioContext(), 57, 1.5);
});
