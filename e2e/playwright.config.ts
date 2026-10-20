import { defineConfig, devices } from '@playwright/test'

// The scripted walk of the 3-minute judge route (docs/testing-overview.md, layer 3).
// `serve.mjs` starts the server with the AI stand-in on its own port and a fresh database, so the walk never touches
// the demo you may have open on 8000 or 8030, and never needs a key. The front end must be built first
// (`npm run build` in prototype/frontend): the server serves frontend/dist.
const PORT = process.env.KEYNECTION_E2E_PORT ?? '8031'

export default defineConfig({
  testDir: '.',
  testMatch: ['route.spec.ts', 'warranty.spec.ts', 'bothsides.spec.ts', 'a11y.spec.ts', 'monkey.spec.ts', 'audit.spec.ts', 'ai-off.spec.ts', 'assistant.spec.ts'], // each starts from the fictional phase as seeded
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    // 1920×1080: deck-sized frames, and wide enough (≥ 1600 px) for the Guide to be a side column instead of a drawer.
    viewport: { width: 1920, height: 1080 },
    locale: 'en-MY',
    timezoneId: 'Asia/Kuala_Lumpur',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node serve.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
