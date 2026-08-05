import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts contend for the GPU, and the
  // frame-time collapse makes game time drift from wall time, flaking timed
  // gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    // Reuse a dev server that is already up: the canvas inspector and these
    // tests share one, and a second bind on 5188 just fails.
    reuseExistingServer: true,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] sets no channel, so Playwright launches the
        // bundled headless shell, which has no GPU backend and falls back to
        // SwiftShader (CPU) — roughly 4x slower raster and meaningless FPS.
        // The full Chromium build renders headless on the real GPU.
        channel: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // Mid-range Android is the device class the portal requirements are
      // written against, and Chromium is what it runs. Emulating an iPhone via
      // headless WebKit would test neither the target browser nor a real GPU.
      name: 'mobile-android',
      use: {
        ...devices['Pixel 5'],
        channel: 'chromium',
      },
    },
  ],
});
