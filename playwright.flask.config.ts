import { defineConfig } from '@playwright/test';

// Runs against the app built for the Flask server (scripts/export-messier.sh) and served by a local
// copy of that server, e.g. on port 5340: SH_FLASK_URL=http://127.0.0.1:5340/schonberg/ SH_DATA_DIR=…
// npx playwright test -c playwright.flask.config.ts
const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e-flask',
  timeout: 180_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.SH_FLASK_URL ?? 'http://127.0.0.1:5340/schonberg/',
    viewport: { width: 390, height: 844 },
    permissions: ['microphone'],
    browserName: 'chromium',
    launchOptions: { executablePath, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
});
