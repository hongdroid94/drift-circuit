#!/usr/bin/env node
/**
 * Drift onset measurement.
 *
 * Question: at what speed does plain steering — no handbrake — push the car
 * past its drift threshold?
 *
 * Some slide from hard high-speed cornering is intended. The design intent is
 * that a drift should be something the player *commits to*, so if steering
 * alone triggers it at ordinary cornering speeds, the handbrake is redundant
 * and the decision the mechanic is built around disappears.
 *
 * Sweeps target speed x steering input per car and reports the lowest speed at
 * which each steer level registers a drift.
 */
import { chromium } from '@playwright/test';

const url = 'http://127.0.0.1:5188';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARS = ['comet', 'vortex', 'ember'];
const SPEEDS_KPH = [60, 90, 120, 150, 180];
const STEERS = [0.5, 1.0];

let browser;
try {
  browser = await chromium.launch({ channel: 'chromium' });
} catch {
  browser = await chromium.launch();
}
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

// Unlock every car so all three are selectable.
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
}, CARS);

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

const rows = [];

for (const carId of CARS) {
  for (const targetKph of SPEEDS_KPH) {
    for (const steer of STEERS) {
      // Fresh race each sample so skid state and boost never carry over.
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('menu'));
      await sleep(150);
      await page.locator(`[data-car="${carId}"]`).click();
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
      await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');

      // Accelerate straight to the target speed.
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
      const reached = await page
        .waitForFunction(
          (kph) => (window.__THREE_GAME_DIAGNOSTICS__?.player.speedKph ?? 0) >= kph,
          targetKph,
          { timeout: 12000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!reached) {
        rows.push({ carId, targetKph, steer, reachable: false });
        continue;
      }

      // Steer, no handbrake. Sample peak slip over the turn.
      await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__?.drive(1, s), steer);
      let peakSlip = 0;
      let drifted = false;
      let entrySpeed = 0;
      for (let i = 0; i < 12; i += 1) {
        const d = await page.evaluate(() => {
          const g = window.__THREE_GAME_DIAGNOSTICS__;
          return {
            slip: Math.abs(g?.player.slipDegrees ?? 0),
            drifting: g?.player.drifting ?? false,
            kph: g?.player.speedKph ?? 0,
          };
        });
        if (i === 0) entrySpeed = d.kph;
        peakSlip = Math.max(peakSlip, d.slip);
        drifted ||= d.drifting;
        await sleep(80);
      }
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());

      rows.push({
        carId,
        targetKph,
        steer,
        reachable: true,
        entrySpeedKph: Math.round(entrySpeed),
        peakSlipDeg: Number(peakSlip.toFixed(1)),
        driftedWithoutHandbrake: drifted,
      });
    }
  }
}

await browser.close();

console.log('car     steer  targetKph  entryKph  peakSlip  driftedNoHandbrake');
for (const r of rows) {
  if (!r.reachable) {
    console.log(`${r.carId.padEnd(7)} ${String(r.steer).padEnd(6)} ${String(r.targetKph).padEnd(10)} (never reached that speed)`);
    continue;
  }
  console.log(
    `${r.carId.padEnd(7)} ${String(r.steer).padEnd(6)} ${String(r.targetKph).padEnd(10)} ` +
      `${String(r.entrySpeedKph).padEnd(9)} ${String(r.peakSlipDeg).padEnd(9)} ${r.driftedWithoutHandbrake ? 'YES' : 'no'}`,
  );
}

console.log('\nLowest speed that drifts on steering alone:');
for (const carId of CARS) {
  for (const steer of STEERS) {
    const hit = rows.find(
      (r) => r.carId === carId && r.steer === steer && r.driftedWithoutHandbrake,
    );
    console.log(`  ${carId.padEnd(7)} steer ${steer}: ${hit ? `${hit.targetKph} km/h` : 'never'}`);
  }
}
