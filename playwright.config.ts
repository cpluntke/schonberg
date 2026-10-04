import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => path.join(here, 'e2e', 'fixtures', f);
const baseArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];
const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5179',
    permissions: ['microphone'],
  },
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      // Default project for app tests (fake mic = Chromium's built-in beep).
      name: 'chromium',
      testIgnore: /fake-mic\.spec\.ts/,
      use: { browserName: 'chromium', launchOptions: { executablePath, args: baseArgs } },
    },
    {
      // Fake microphone fed from a WAV (looped by Chromium).
      name: 'mic-a3',
      testMatch: /fake-mic\.spec\.ts/,
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath,
          args: [...baseArgs, `--use-file-for-fake-audio-capture=${fixture('a3-sustain.wav')}`],
        },
      },
    },
    {
      name: 'mic-scale',
      testMatch: /fake-mic\.spec\.ts/,
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath,
          args: [...baseArgs, `--use-file-for-fake-audio-capture=${fixture('scale.wav')}`],
        },
      },
    },
  ],
});
