/**
 * Fixed-timestep game loop with render interpolation.
 *
 * Physics runs at exactly FIXED_HZ regardless of display refresh rate, so car
 * handling feels identical on 60Hz and 144Hz screens and lap times stay
 * comparable across machines. Rendering interpolates between the previous and
 * current physics states using the leftover accumulator, so motion stays smooth
 * even though simulation is quantized.
 */

export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;

/** Never simulate more than this many steps in one frame (spiral-of-death guard). */
const MAX_STEPS_PER_FRAME = 5;

export class Loop {
  private frameId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  /** Smoothed frames-per-second, used by the quality manager. */
  fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(
    /** Advance simulation by exactly FIXED_DT. */
    private readonly fixedUpdate: (dt: number) => void,
    /**
     * Draw a frame. `alpha` is the interpolation factor in [0,1) between the
     * previous and current physics state.
     */
    private readonly render: (alpha: number, frameDelta: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private readonly tick = (time: number) => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.tick);

    // Clamp the delta so an alt-tab or a GC pause cannot dump a hundred steps
    // into one frame.
    const frameDelta = Math.min((time - this.lastTime) / 1000, 0.25);
    this.lastTime = time;

    this.fpsAccum += frameDelta;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    this.accumulator += frameDelta;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }

    // If we hit the step cap we are running slower than real time; drop the
    // backlog rather than accumulating debt forever.
    if (steps >= MAX_STEPS_PER_FRAME) {
      this.accumulator = 0;
    }

    this.render(this.accumulator / FIXED_DT, frameDelta);
  };
}
