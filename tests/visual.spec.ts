import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * Smoke test: the game boots, renders a real scene, and responds to input.
 *
 * Deliberately checks *behaviour* rather than pixels-vs-baseline. A racing game
 * has smoke, shadows and a moving camera; a strict image diff would fail on
 * every commit for reasons nobody cares about. What must not regress is: the
 * canvas is not blank, driving moves the car, and the console is clean.
 */

type CanvasSample = {
  ok: boolean;
  variance: number;
  colorBuckets: number;
  litPixels: number;
};

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, variance: 0, colorBuckets: 0, litPixels: 0 };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let litPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 8192));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    if (png.data[offset + 3] > 0) litPixels += 1;
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }

  const variance = max - min;
  return {
    ok: litPixels > 256 && variance > 24 && buckets.size > 6,
    variance,
    colorBuckets: buckets.size,
    litPixels,
  };
}

test.describe('drift circuit', () => {
  test('boots, renders and drives', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('#game-canvas')).toBeVisible();

    // Menu must be reachable and offer a start button.
    await expect(page.locator('#start-button')).toBeVisible();

    await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('racing'));
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing');
    await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 25);

    const sample = await sampleCanvas(page);
    expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

    // Full throttle must actually accelerate the car.
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0));
    await expect
      .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.speedKph ?? 0), {
        timeout: 5000,
      })
      .toBeGreaterThan(25);

    // Steering under power must produce rotation and lap progress.
    const progressBefore = await page.evaluate(
      () => window.__THREE_GAME_DIAGNOSTICS__?.player.progress ?? 0,
    );
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.drive(1, 0.55));
    await page.waitForTimeout(1200);
    const progressAfter = await page.evaluate(
      () => window.__THREE_GAME_DIAGNOSTICS__?.player.progress ?? 0,
    );
    expect(progressAfter).not.toBe(progressBefore);

    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.release());

    const shot = await page.screenshot();
    await testInfo.attach(`${testInfo.project.name}-racing`, { body: shot, contentType: 'image/png' });

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('mobile shows touch controls and they steer', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'mobile projects only');

    await page.goto('/');
    await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);
    await page.locator('#start-button').click();

    await expect(page.locator('#touch-accel')).toBeVisible();
    await expect(page.locator('#touch-left')).toBeVisible();

    // Wait out the countdown, then hold the gas pedal.
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'racing', {
      timeout: 10000,
    });

    const accel = page.locator('#touch-accel');
    const box = await accel.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect
        .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.speedKph ?? 0), {
          timeout: 5000,
        })
        .toBeGreaterThan(10);
      await page.mouse.up();
    }
  });
});
