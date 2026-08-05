#!/usr/bin/env node
/**
 * Capture the game in each of its player-facing states, on desktop and mobile.
 *
 * Screenshots of a menu prove nothing about a racing game, so this drives the
 * car for real: autopilot to build speed, then a forced handbrake slide to
 * catch an actual drift with smoke and skid marks on screen. Everything it
 * writes is evidence about a live simulation, not a posed scene.
 *
 * Usage: node scripts/capture-states.mjs [--url URL] [--out DIR]
 */
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = { url: 'http://127.0.0.1:5188', out: 'artifacts/states' };
for (let i = 0; i < process.argv.slice(2).length; i += 1) {
  const argv = process.argv.slice(2);
  if (argv[i] === '--url') args.url = argv[++i];
  else if (argv[i] === '--out') args.out = argv[++i];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch() {
  try {
    return await chromium.launch({ channel: 'chromium' });
  } catch {
    console.error('warning: real-GPU chromium unavailable; falling back to software raster');
    return chromium.launch();
  }
}

async function diag(page) {
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ ?? null);
}

async function captureProfile(browser, { name, contextOptions }) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const shots = {};
  const shoot = async (label) => {
    const file = path.join(args.out, `${name}-${label}.png`);
    await page.screenshot({ path: file });
    shots[label] = file;
  };

  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5, { timeout: 20000 });
  await shoot('menu');

  // --- racing -----------------------------------------------------------
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setAutopilot(true));

  // Let the bot get properly up to speed and into the first corner.
  await sleep(9000);
  const cruising = await diag(page);
  await shoot('racing');

  // --- drift ------------------------------------------------------------
  // Take manual control and provoke a *representative* slide, not a spin: a
  // brief handbrake stab to break traction, then throttle and partial lock to
  // hold the angle. Full lock plus handbrake at 100 kph just sends the car off
  // the circuit, which is honest physics but a useless screenshot.
  // Scrub speed first. Entering a slide at 100 kph simply carries the car off
  // the outside of the corner — realistic, but a screenshot of a car on grass
  // is not what the mechanic looks like when it is working.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(-1, 0.15, false));
  await sleep(700);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(0.5, 0.8, true));
  await sleep(360);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(0.9, 0.6, false));
  await sleep(620);
  const drifting = await diag(page);
  await shoot('drift');

  // --- results ----------------------------------------------------------
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('results'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'results');
  await sleep(400);
  await shoot('results');

  await context.close();

  return {
    profile: name,
    shots,
    cruising: cruising && {
      speedKph: Math.round(cruising.player.speedKph),
      fps: cruising.fps,
      calls: cruising.renderer.calls,
      triangles: cruising.renderer.triangles,
      tier: cruising.canvas.tier,
      dpr: cruising.canvas.dpr,
      drawingBuffer: `${cruising.canvas.width}x${cruising.canvas.height}`,
    },
    drifting: drifting && {
      speedKph: Math.round(drifting.player.speedKph),
      slipDegrees: Number(drifting.player.slipDegrees.toFixed(1)),
      drifting: drifting.player.drifting,
      driftScore: drifting.lap.driftScore,
      boost: Number(drifting.player.boost.toFixed(2)),
      calls: drifting.renderer.calls,
      triangles: drifting.renderer.triangles,
    },
    consoleErrors,
    pageErrors,
  };
}

const browser = await launch();
await mkdir(args.out, { recursive: true });

const report = [];
report.push(
  await captureProfile(browser, {
    name: 'desktop',
    contextOptions: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  }),
);
report.push(
  await captureProfile(browser, {
    name: 'mobile',
    // Pixel 5 landscape: the orientation a racing game is actually played in.
    contextOptions: {
      ...devices['Pixel 5 landscape'],
      channel: undefined,
    },
  }),
);

await browser.close();
await writeFile(path.join(args.out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
