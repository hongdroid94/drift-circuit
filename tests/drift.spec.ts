import { expect, test, type Page } from '@playwright/test';
import { CARS } from '../src/data/cars';

/**
 * Drift is the core mechanic, so it gets its own regression test.
 *
 * The failure this guards against is subtle and was real: tuning can leave a
 * car whose slip threshold is so high that ordinary play never registers a
 * drift. Nothing crashes, no test fails, the game just quietly stops having a
 * mechanic. Every car must be able to break traction with input a player would
 * actually produce — a handbrake stab plus throttle and part lock — and must
 * convert that into banked boost.
 */

async function startRace(page: Page, carId: string): Promise<void> {
  // Seed the save before the app boots so locked cars are selectable. Written
  // through the real save key and schema rather than a test-only backdoor, so
  // if the save format changes this breaks loudly instead of silently testing
  // a default car three times.
  await page.addInitScript((ids: string[]) => {
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
  }, CARS.map((car) => car.id));

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

  const card = page.locator(`[data-car="${carId}"]`);
  await expect(card, `${carId} should be selectable after seeding the save`).toBeEnabled();
  await card.click();

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');
}

/** Accelerate in a straight line until we are well above the drift speed floor. */
async function getUpToSpeed(page: Page, targetKph: number): Promise<void> {
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.speedKph ?? 0), {
      timeout: 10000,
    })
    .toBeGreaterThan(targetKph);
}

test.describe('drift mechanic', () => {
  test.describe.configure({ mode: 'serial' });

  for (const car of CARS) {
    test(`${car.name} can break traction and bank boost`, async ({ page }) => {
      await startRace(page, car.id);
      await getUpToSpeed(page, 80);

      // Handbrake stab to break the rear loose, then hold it with throttle and
      // partial lock. This is the input a player produces, not a scripted spin.
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(0.7, 0.6, true));
      await page.waitForTimeout(380);
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0.5, false));

      // Sample continuously: the peak slip and the drifting flag can both be
      // transient, so polling a single snapshot at the end would be flaky.
      let peakSlip = 0;
      let sawDrifting = false;
      for (let i = 0; i < 14; i += 1) {
        const snapshot = await page.evaluate(() => {
          const d = window.__THREE_GAME_DIAGNOSTICS__;
          return {
            slip: Math.abs(d?.player.slipDegrees ?? 0),
            drifting: d?.player.drifting ?? false,
          };
        });
        peakSlip = Math.max(peakSlip, snapshot.slip);
        sawDrifting ||= snapshot.drifting;
        await page.waitForTimeout(70);
      }

      const thresholdDegrees = car.driftAngle * (180 / Math.PI);
      expect(
        peakSlip,
        `${car.name} peaked at ${peakSlip.toFixed(1)}deg slip, threshold is ${thresholdDegrees.toFixed(1)}deg`,
      ).toBeGreaterThan(thresholdDegrees);
      expect(sawDrifting, `${car.name} never registered as drifting`).toBe(true);

      // Straighten up: the drift should convert into banked boost.
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const d = window.__THREE_GAME_DIAGNOSTICS__;
              return Math.max(d?.player.boost ?? 0, d?.lap.driftScore ?? 0);
            }),
          { timeout: 4000 },
        )
        .toBeGreaterThan(0);

      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());
    });
  }
});
