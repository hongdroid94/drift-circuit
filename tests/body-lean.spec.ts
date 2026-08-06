import { expect, test, type Page } from '@playwright/test';

/**
 * Which way the car leans in a corner.
 *
 * This is cosmetic, but it is the sort of cosmetic that reads as "wrong game"
 * rather than "small bug": a car that leans *into* a corner looks like a
 * motorbike, and the lean exists precisely to sell weight transfer.
 *
 * The sign chain runs lateral acceleration -> `Vehicle.roll` -> the model's
 * `body.rotation.z`. `car-model.spec.ts` measures the second half off the
 * geometry (positive roll drops the car's right side). This measures the
 * first half in a real browser, so the two together pin the visible result
 * without either of them assuming the other's convention.
 *
 * Turning right, a car's mass swings left, the left suspension compresses and
 * the body tips left — the right side rises. Positive roll drops the right
 * side, so a right-hand turn must produce a NEGATIVE roll.
 */

async function raceAtSpeed(page: Page, targetKph: number): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.speedKph ?? 0), {
      timeout: 10000,
    })
    .toBeGreaterThan(targetKph);
}

/** Steer and report the roll angle at its largest magnitude during the turn. */
async function peakRoll(page: Page, steer: number): Promise<number> {
  await page.evaluate((s) => window.__THREE_GAME_TEST_HOOKS__?.drive(1, s), steer);

  let peak = 0;
  for (let i = 0; i < 10; i += 1) {
    const roll = await page.evaluate(
      () => window.__THREE_GAME_DIAGNOSTICS__?.player.roll ?? 0,
    );
    if (Math.abs(roll) > Math.abs(peak)) peak = roll;
    await page.waitForTimeout(70);
  }

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());
  return peak;
}

test.describe('body lean direction', () => {
  test.describe.configure({ mode: 'serial' });

  test('leans out of a right-hand turn', async ({ page }) => {
    // Moderate lock at a moderate speed: enough lateral load to lean clearly,
    // not enough to break traction, where the slide muddies the reading.
    await raceAtSpeed(page, 85);
    const roll = await peakRoll(page, 0.6);

    expect(
      Math.abs(roll),
      `the car barely leaned at all (roll ${roll.toFixed(4)} rad)`,
    ).toBeGreaterThan(0.01);
    expect(
      roll,
      `turning right produced roll ${roll.toFixed(4)} rad; negative means the ` +
        'right side rises, i.e. leaning out of the corner as a car should',
    ).toBeLessThan(0);
  });

  test('leans the opposite way in a left-hand turn', async ({ page }) => {
    await raceAtSpeed(page, 85);
    const roll = await peakRoll(page, -0.6);

    expect(Math.abs(roll)).toBeGreaterThan(0.01);
    expect(roll, `turning left produced roll ${roll.toFixed(4)} rad`).toBeGreaterThan(0);
  });
});
