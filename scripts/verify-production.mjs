#!/usr/bin/env node
/**
 * Production build smoke check.
 *
 * The dev server and the built bundle are different programs: the build strips
 * the test hooks, rewrites asset paths, and minifies. That means every
 * automation affordance the other scripts rely on is gone here — so this drives
 * the game the way a player does, through the real menu button and the keyboard.
 *
 * Checks: the bundle boots, the canvas renders a real scene, a race starts from
 * a click, driving moves the car, no console or page errors, and the debug
 * globals are genuinely absent.
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://127.0.0.1:4188';
const out = 'artifacts/production';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pixelStats(buffer) {
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  const buckets = new Set();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 8192));
  for (let p = 0; p < png.width * png.height; p += stride) {
    const o = p * 4;
    min = Math.min(min, png.data[o], png.data[o + 1], png.data[o + 2]);
    max = Math.max(max, png.data[o], png.data[o + 1], png.data[o + 2]);
    buckets.add(`${png.data[o] >> 4},${png.data[o + 1] >> 4},${png.data[o + 2] >> 4}`);
  }
  return { variance: max - min, colorBuckets: buckets.size };
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chromium' });
} catch {
  browser = await chromium.launch();
}

const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => pageErrors.push(e.message));

await mkdir(out, { recursive: true });
const failures = [];

await page.goto(url, { waitUntil: 'networkidle' });

// Debug surface must not exist in a shipped build.
const hooks = await page.evaluate(() => ({
  testHooks: typeof window.__THREE_GAME_TEST_HOOKS__,
  diagnostics: typeof window.__THREE_GAME_DIAGNOSTICS__,
}));
if (hooks.testHooks !== 'undefined') failures.push('__THREE_GAME_TEST_HOOKS__ is exposed in production');
if (hooks.diagnostics !== 'undefined') failures.push('__THREE_GAME_DIAGNOSTICS__ is exposed in production');

// The loading overlay must actually go away.
await page.waitForSelector('#loading', { state: 'detached', timeout: 20000 }).catch(() => {
  failures.push('loading overlay never cleared');
});

await page.waitForSelector('#start-button', { timeout: 10000 });
await page.screenshot({ path: path.join(out, 'menu.png') });

// Start a race through the real UI, then wait out the countdown.
await page.locator('#start-button').click();
await sleep(4600);

const canvas = page.locator('#game-canvas');
const beforeShot = await canvas.screenshot();
const before = pixelStats(beforeShot);
if (before.variance < 24 || before.colorBuckets < 6) {
  failures.push(`canvas looks blank: ${JSON.stringify(before)}`);
}

// Drive with the keyboard and confirm the view actually changes.
await page.keyboard.down('KeyW');
await sleep(2200);
const movingShot = await canvas.screenshot();
await page.screenshot({ path: path.join(out, 'racing.png') });
await page.keyboard.up('KeyW');

// The speed readout is the only state a production build exposes; it must be
// non-zero after two seconds of throttle.
const speedText = (await page.locator('#speed-value').textContent()) ?? '0';
const speed = Number.parseInt(speedText, 10);
if (!Number.isFinite(speed) || speed < 20) {
  failures.push(`car did not accelerate on keyboard input (speed readout: "${speedText}")`);
}

const moving = pixelStats(movingShot);
if (moving.colorBuckets < 6) failures.push('scene stopped rendering while driving');

// Pause must open, so the player is never trapped in a race.
await page.keyboard.press('Escape');
await sleep(400);
const paused = await page.locator('#resume').count();
if (paused !== 1) failures.push('Escape did not open the pause menu');
await page.screenshot({ path: path.join(out, 'paused.png') });

if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(' | ')}`);
if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`);

const report = {
  url,
  ok: failures.length === 0,
  failures,
  evidence: { hooks, canvasBefore: before, canvasMoving: moving, speedKph: speed },
};

await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await context.close();
await browser.close();

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
