#!/usr/bin/env node
/**
 * Timeline of a single off-road excursion.
 *
 * After the yaw clamp was tied to actual grip, steering alone stopped breaking
 * traction on the road at every speed and lock. One case survived: holding a
 * moderate turn at 60 km/h still reached ~88 degrees of slip once the car left
 * the tarmac. Grip alone does not explain it — at that speed the clamp holds
 * the demanded lateral acceleration to exactly what grass provides.
 *
 * The other force that can move the car sideways is the soft barrier, which
 * shoves at BARRIER_PUSH (55 m/s^2) — several times tyre grip — straight along
 * the track normal. That is velocity the tyres never asked for, so it lands as
 * slip angle.
 *
 * This prints a per-sample timeline rather than an aggregate, so the moment
 * slip explodes can be lined up against `offTrack` and `atBarrier` instead of
 * guessed at.
 */
import { chromium } from '@playwright/test';

const url = 'http://127.0.0.1:5188';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAR = process.argv[2] ?? 'comet';
const STEER = Number(process.argv[3] ?? 0.35);
const TARGET_KPH = Number(process.argv[4] ?? 60);

let browser;
try {
  browser = await chromium.launch({ channel: 'chromium' });
} catch {
  browser = await chromium.launch();
}
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

await page.addInitScript((ids) => {
  localStorage.setItem(
    'arcade-racer:save:v1',
    JSON.stringify({
      version: 1,
      records: {},
      unlockedCars: ids,
      selectedCar: ids[0],
      selectedTrack: 'sunset-loop',
      quality: 'high',
      muted: true,
      totalRaces: 0,
    }),
  );
}, ['comet', 'vortex', 'ember']);

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);
await page.locator(`[data-car="${CAR}"]`).click();
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');

await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
await page.waitForFunction(
  (kph) => (window.__THREE_GAME_DIAGNOSTICS__?.player.speedKph ?? 0) >= kph,
  TARGET_KPH,
  { timeout: 15000 },
);

await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__?.drive(1, s), STEER);

console.log(`${CAR}  steer ${STEER}  entry ~${TARGET_KPH} km/h  (no handbrake)`);
console.log('  t(s)   kph   slip   offTrack  atBarrier  drifting');
const INTERVAL_MS = Number(process.argv[5] ?? 80);
const STEPS = Math.round(3200 / INTERVAL_MS);
for (let i = 0; i < STEPS; i += 1) {
  const d = await page.evaluate(() => {
    const g = window.__THREE_GAME_DIAGNOSTICS__;
    return {
      kph: g?.player.speedKph ?? 0,
      slip: Math.abs(g?.player.slipDegrees ?? 0),
      off: g?.player.offTrack ?? false,
      barrier: g?.player.atBarrier ?? false,
      drifting: g?.player.drifting ?? false,
    };
  });
  console.log(
    `  ${(i * INTERVAL_MS / 1000).toFixed(2).padStart(5)} ` +
      `${d.kph.toFixed(0).padStart(5)} ` +
      `${d.slip.toFixed(1).padStart(6)} ` +
      `${(d.off ? 'GRASS' : '-').padStart(9)} ` +
      `${(d.barrier ? 'PUSH' : '-').padStart(10)} ` +
      `${(d.drifting ? 'DRIFT' : '-').padStart(9)}`,
  );
  await sleep(INTERVAL_MS);
}

await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());
await browser.close();
