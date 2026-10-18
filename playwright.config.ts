import { defineConfig } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    // Используем установленный Chrome — отдельный браузер скачивать не нужно.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1360, height: 1000 },
  },
  webServer: {
    command: 'node server.mjs --no-open',
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
