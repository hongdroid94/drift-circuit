import { expect, test, type Page } from '@playwright/test';

/**
 * Bot playtest.
 *
 * Drives a full lap of every circuit with the autopilot and asserts the lap
 * actually completes. This is the check that catches the failure mode a unit
 * test cannot: a track whose spline is drivable in theory but has a corner the
 * car physically cannot get round, or a lap-validation bug that never fires the
 * finish event. It also prints the reference lap times used to set the
 * gold/silver/bronze targets.
 */

const TRACKS = [
  { id: 'sunset-loop', name: 'Sunset Loop' },
  { id: 'ridge-run', name: 'Ridge Run' },
  { id: 'harbor-twist', name: 'Harbor Twist' },
];

/** Generous: a stuck car must fail the test, not hang the suite. */
const LAP_TIMEOUT_MS = 240_000;

async function selectAndRace(page: Page, trackId: string): Promise<void> {
  await page.locator(`[data-track="${trackId}"]`).click();
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');
  const engaged = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setAutopilot(true));
  expect(engaged, 'autopilot should engage').toBe(true);
}

test.describe('bot playtest', () => {
  test.describe.configure({ mode: 'serial', timeout: LAP_TIMEOUT_MS * 2 });

  for (const track of TRACKS) {
    test(`completes a lap of ${track.name}`, async ({ page }, testInfo) => {
      // Drivability is a property of the track and the physics, not the
      // viewport. Running three full 3-lap races per device profile would
      // triple suite time to prove the same thing.
      test.skip(!testInfo.project.name.includes('desktop'), 'desktop project only');
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto('/');
      await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);
      await selectAndRace(page, track.id);

      // Progress must actually advance; a car wedged against a barrier at 0.03
      // for ten seconds is a failure worth catching early.
      let stalledFor = 0;
      let lastProgress = 0;
      let peakProgress = 0;
      const started = Date.now();

      while (Date.now() - started < LAP_TIMEOUT_MS) {
        const snapshot = await page.evaluate(() => {
          const d = window.__THREE_GAME_DIAGNOSTICS__;
          return {
            phase: d?.phase ?? 'menu',
            progress: d?.player.progress ?? 0,
            speed: d?.player.speedKph ?? 0,
            lapTime: d?.lap.time ?? 0,
            drift: d?.lap.driftScore ?? 0,
          };
        });

        if (snapshot.phase === 'results') break;

        peakProgress = Math.max(peakProgress, snapshot.progress);
        stalledFor = Math.abs(snapshot.progress - lastProgress) < 0.0005 ? stalledFor + 1 : 0;
        lastProgress = snapshot.progress;
        expect(stalledFor, `car stalled at progress ${snapshot.progress.toFixed(3)}`).toBeLessThan(40);

        await page.waitForTimeout(250);
      }

      const final = await page.evaluate(() => {
        const d = window.__THREE_GAME_DIAGNOSTICS__;
        return { phase: d?.phase ?? 'menu', best: d?.lap.best ?? 0, drift: d?.lap.driftScore ?? 0 };
      });

      expect(final.phase, `lap did not finish (peak progress ${peakProgress.toFixed(3)})`).toBe('results');

      const cells = await page.locator('.result-value').allTextContents();
      console.log(
        `[bot] ${track.name}: best ${cells[0]}, total ${cells[1]}, drift ${cells[3]}, ` +
          `laps [${cells.slice(4).join(', ')}]`,
      );

      expect(pageErrors, pageErrors.join(' | ')).toEqual([]);
    });
  }
});
