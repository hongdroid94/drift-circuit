#!/usr/bin/env node
/**
 * Steering direction diagnostic.
 *
 * Answers one question objectively: when the player holds "steer right", does
 * the car move toward the right-hand side of the *screen*?
 *
 * The measurement is a projection of the car's displacement onto the camera's
 * own +X axis (screen right), sampled from the camera's world matrix. That
 * avoids arguing about handedness conventions on paper — whatever the maths
 * says, the sign of this number is what the player sees.
 */
import { chromium } from '@playwright/test';

const url = 'http://127.0.0.1:5188';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
try {
  browser = await chromium.launch({ channel: 'chromium' });
} catch {
  browser = await chromium.launch();
}
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

const results = [];

for (const steer of [1, -1]) {
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('menu'));
  await sleep(300);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');

  // Build speed in a straight line first so the camera settles behind the car.
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
  await sleep(2500);

  const before = await page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    return { pos: d.player.position, camRight: d.camera.right, camFwd: d.camera.forward };
  });

  await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__?.drive(1, s), steer);
  await sleep(1400);

  const after = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.player.position);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());

  // Displacement relative to where the car would have been going straight:
  // project onto the pre-turn camera-right and camera-forward axes.
  const dx = after.x - before.pos.x;
  const dz = after.z - before.pos.z;
  const alongRight = dx * before.camRight.x + dz * before.camRight.z;
  const alongForward = dx * before.camFwd.x + dz * before.camFwd.z;

  results.push({
    steerInput: steer,
    expected: steer > 0 ? 'screen-right (positive)' : 'screen-left (negative)',
    displacementAlongScreenRight: Number(alongRight.toFixed(2)),
    displacementAlongScreenForward: Number(alongForward.toFixed(2)),
    cameraRight: {
      x: Number(before.camRight.x.toFixed(3)),
      z: Number(before.camRight.z.toFixed(3)),
    },
    correct: steer > 0 ? alongRight > 0 : alongRight < 0,
  });
}

const allCorrect = results.every((r) => r.correct);
console.log(JSON.stringify({ steeringCorrect: allCorrect, results }, null, 2));

await browser.close();
process.exit(allCorrect ? 0 : 1);
