/// <reference types="vite/client" />

/**
 * Automation contract.
 *
 * The `renderer` and `canvas` blocks are required by
 * `scripts/inspect-threejs-canvas.mjs`, which checks them against its render
 * budget — keep their field names as-is even if nothing in the game reads them.
 * Everything else is this game's own telemetry.
 */
interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  fps: number;
  phase: 'menu' | 'countdown' | 'racing' | 'paused' | 'results';
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
    speedKph: number;
    slipDegrees: number;
    boost: number;
    progress: number;
    grounded: boolean;
    drifting: boolean;
  };
  lap: {
    time: number;
    best: number;
    driftScore: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
    tier: string;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed gameplay randomness. Scenery is already seeded per track. */
  seed(value: number): void;
  /** Jump to a named state: 'menu' | 'racing' | 'results'. */
  setState(name: string): boolean;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide debug overlays before capturing. */
  hideDebugUi(hidden: boolean): void;
  /** Push synthetic input for bot playtests. */
  drive(throttle: number, steer: number, handbrake?: boolean): void;
  /** Release synthetic input back to real devices. */
  release(): void;
  /** Engage the centreline-following bot driver. */
  setAutopilot(enabled: boolean): boolean;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
