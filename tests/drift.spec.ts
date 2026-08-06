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

    test(`${car.name} does not drift on steering alone at moderate speed`, async ({ page }) => {
      await startRace(page, car.id);
      await getUpToSpeed(page, 70);

      // Full lock, no handbrake. This must NOT register a drift: if it does,
      // the handbrake is redundant and the mechanic stops being a decision.
      //
      // Regression guard. Before the yaw rate was clamped by available grip,
      // this exact input produced 60-89 degrees of slip on every car — a spin
      // rather than a drift — because the heading rotated at the full steering
      // rate no matter how little grip remained.
      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 1));

      // Held long enough for slip to *accumulate*, not just spike. An earlier
      // version of this test sampled for 0.8s and ignored anything under
      // 40 km/h, and passed a build where holding the same lock for 2.4s
      // reached 22 degrees and drifted — it stopped watching immediately
      // before the failure it existed to catch.
      //
      // Off-road samples are excluded instead: grass halves grip, so a slide
      // there is the surface talking, not steering breaking traction.
      let peakSlip = 0;
      let sawDrifting = false;
      let sawOnRoadSample = false;
      for (let i = 0; i < 30; i += 1) {
        const snapshot = await page.evaluate(() => {
          const d = window.__THREE_GAME_DIAGNOSTICS__;
          return {
            slip: Math.abs(d?.player.slipDegrees ?? 0),
            drifting: d?.player.drifting ?? false,
            offTrack: d?.player.offTrack ?? false,
          };
        });
        if (!snapshot.offTrack) {
          sawOnRoadSample = true;
          peakSlip = Math.max(peakSlip, snapshot.slip);
          sawDrifting ||= snapshot.drifting;
        }
        await page.waitForTimeout(80);
      }
      expect(sawOnRoadSample, `${car.name} never produced an on-road sample`).toBe(true);

      expect(
        sawDrifting,
        `${car.name} drifted from steering alone (peak slip ${peakSlip.toFixed(1)}deg) — ` +
          'the grip clamp on yaw rate has regressed',
      ).toBe(false);

      // Cornering should still be lively, just short of a drift. A completely
      // dead front end would pass the check above for the wrong reason.
      expect(peakSlip, `${car.name} showed no slide at all at full lock`).toBeGreaterThan(2);

      await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());
    });
  }

  /**
   * Running wide is not a drift.
   *
   * The barrier used to shove the car back toward the road at 55 m/s^2 —
   * several times tyre grip — while leaving the heading untouched. Slip angle
   * is the gap between heading and travel, so all of that shove landed as
   * slip: measured going from 6.7 degrees to 87 within a second of contact,
   * with 102 km/h collapsing to 2. Clipping a verge spun the car and paid out
   * drift score for it.
   *
   * Only the starter car is covered. This is a property of the barrier, not of
   * any car's tuning, and the excursion takes long enough that running it
   * three times buys nothing.
   */
  test('being pushed by the barrier does not count as a drift', async ({ page }) => {
    await startRace(page, CARS[0].id);
    await getUpToSpeed(page, 90);

    // Hold a turn until the car runs wide and reaches the barrier.
    //
    // `waitForFunction` rather than `expect.poll`: poll backs off to second-long
    // gaps, and where the car ends up depends on where on the circuit it was
    // when the steering went on, so a late start changed the excursion entirely
    // and the barrier was sometimes never reached. This samples every frame.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0.6));
    await page.waitForFunction(
      () => window.__THREE_GAME_DIAGNOSTICS__?.player.atBarrier === true,
      undefined,
      { timeout: 15000 },
    );

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

    // Measured at 9.1 degrees over three runs once the barrier turns the
    // heading along with the velocity. 25 leaves room for surface and
    // entry-angle variation while staying far below the 87 that started this.
    expect(peakSlip, `barrier contact produced ${peakSlip.toFixed(1)}deg of slip`).toBeLessThan(25);
    expect(sawDrifting, 'barrier contact registered as a drift').toBe(false);

    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());
  });
});
