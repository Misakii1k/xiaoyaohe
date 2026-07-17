import { defineConfig } from '@playwright/test';

// Windows developer machines commonly have Chrome while the Playwright cache
// may be absent. CI keeps using its provisioned Playwright Chromium.
const localChromeChannel = process.platform === 'win32' && !process.env.CI ? 'chrome' : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  outputDir: 'output/playwright/test-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: localChromeChannel,
    serviceWorkers: 'block',
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone-320', use: { viewport: { width: 320, height: 568 } } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet-landscape', use: { viewport: { width: 768, height: 500 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
