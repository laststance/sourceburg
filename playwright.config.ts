import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. Runs against a production build because Shiki highlighting and
 * font subsetting are build-time steps; `next dev` would not exercise them.
 * The three viewport widths match DESIGN.md's responsive breakpoints.
 */

/*
 * Not 3000. `reuseExistingServer` is on locally, so a different app already
 * listening on the default port would be silently tested instead of this one,
 * and the suite would report on somebody else's HTML. Overridable for CI.
 */
const PORT = process.env.E2E_PORT ?? '3101'
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'phone-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
