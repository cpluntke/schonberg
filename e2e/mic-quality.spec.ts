import { test, expect } from '@playwright/test';

// Microphone advice (src/audio/inputQuality.ts): the live mic check in the tuner, with a fake
// microphone carrying mains hum and a voice driven into clipping, and Results for a run with hum.

test('the mic check names hum and clipping on a fake microphone, and the hum isn’t read as a note', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      await ac.resume();
      const dest = ac.createMediaStreamDestination();
      const mix = ac.createGain();
      const tone = (f: number, a: number, to: AudioNode) => { const o = ac.createOscillator(); o.frequency.value = f; const g = ac.createGain(); g.gain.value = a; o.connect(g).connect(to); o.start(); };
      // Mains hum, always on.
      tone(60, 0.02, mix); tone(120, 0.006, mix); tone(180, 0.01, mix);
      // A C#4 "voice", 1.5 s on / 1.5 s off, far too loud: clipped at full scale.
      const voice = ac.createGain();
      voice.gain.value = 0;
      for (const [f, a] of [[277.2, 1], [554.4, 0.5], [831.6, 0.3]]) tone(f, a * 1.6, voice);
      const t0 = ac.currentTime + 0.05;
      for (let k = 0; k < 40; k++) { voice.gain.setValueAtTime(1, t0 + 3 * k + 1.5); voice.gain.setValueAtTime(0, t0 + 3 * k + 3); }
      voice.connect(mix);
      const clip = ac.createWaveShaper();
      clip.curve = new Float32Array([-1, 1]);
      mix.connect(clip).connect(dest);
      return dest.stream;
    };
  });
  await page.goto('/#/tuner');
  await page.getByTestId('mic-start').click();
  await expect(page.getByTestId('mic-advice-clipping')).toContainText('Too loud for the mic', { timeout: 30_000 });
  await expect(page.getByTestId('mic-advice-hum')).toContainText('Electrical hum on your microphone', { timeout: 30_000 });
  // In the pauses the hum (60 Hz, notched) doesn't show as a B1.
  const notes = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const n = (await page.getByTestId('tuner-note').textContent()) ?? '';
    notes.add(n);
    await page.waitForTimeout(150);
  }
  expect(notes.has('B')).toBe(false);
  expect(errors).toEqual([]);
});

test('Results gives the microphone advice and lets off the notes lost to it', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?simulate=perfect#/');
  await page.getByTestId('piece-row').first().click();
  await page.getByLabel('Passages').getByRole('button', { name: /Level 1/ }).first().click();
  await page.getByTestId('hp-yes').click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('pass-banner')).toBeVisible({ timeout: 90_000 });
  // A clean run: no advice.
  await expect(page.getByTestId('mic-advice')).toHaveCount(0);
  // The same result, as if the run had hum and the tracker lost one note to it.
  await page.evaluate(() => {
    const r = JSON.parse(sessionStorage.getItem('sh:lastResult')!);
    Object.assign(r.result.notes[1], { grade: 'miss', hitRatio: 0.2, unsure: 'mic' });
    r.inputQuality = {
      hum: { hz: 58.7, db: -49.5, vsVoiceDb: -30.8 }, clip: { runs: 18, share: 0.009, peak: 1 }, voiceDb: -18.8,
      sub: { db: -9.9, liftedShare: 0.58, n: 452 }, filter: { hp: 72.7, notches: [58.7] }, problems: ['hum', 'distortion'],
    };
    sessionStorage.setItem('sh:lastResult', JSON.stringify(r));
  });
  await page.reload();
  await expect(page.getByTestId('mic-advice-hum')).toContainText('unplug the laptop charger', { ignoreCase: true });
  await expect(page.getByTestId('mic-advice-distortion')).toBeVisible();
  await expect(page.getByTestId('mic-advice-clipping')).toHaveCount(0);
  await expect(page.getByTestId('mic-trouble-notes')).toContainText('counted as wrong');
  await expect(page.getByTestId('wrong-notes')).toHaveCount(0);
  expect(errors).toEqual([]);
});
