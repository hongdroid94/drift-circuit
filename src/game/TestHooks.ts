/**
 * Automation surface for Playwright and the canvas inspector.
 *
 * The global shapes live in `src/vite-env.d.ts` because the inspector script
 * depends on some of their field names; this file only owns installation and
 * the production guard.
 *
 * Both globals are stripped from production builds. A shipped game must not
 * carry a handle that lets anyone teleport the car or fabricate a lap time —
 * the leaderboard is local today, but the habit matters once it is not.
 */

export type GameDiagnostics = ThreeGameDiagnostics;
export type TestHooks = ThreeGameTestHooks;

export const testHooksEnabled = !import.meta.env.PROD;

export function installTestHooks(hooks: TestHooks): boolean {
  if (!testHooksEnabled) return false;
  window.__THREE_GAME_TEST_HOOKS__ = hooks;
  return true;
}

export function publishDiagnostics(diagnostics: GameDiagnostics): void {
  if (!testHooksEnabled) return;
  window.__THREE_GAME_DIAGNOSTICS__ = diagnostics;
}
