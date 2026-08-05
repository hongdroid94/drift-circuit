import type { Vehicle } from '../entities/Vehicle';

/**
 * Drift scoring.
 *
 * The design rule from the PRD: a drift must be a way to *earn boost*, not a
 * faster way through a corner. So the score rewards duration and angle, and a
 * chain multiplier rewards linking corners — but the points themselves never
 * make the car quicker. Only the banked boost does that, and only after you
 * straighten up.
 */

/** Grace window after a drift ends before the chain multiplier resets. */
const CHAIN_WINDOW = 1.5;
const MAX_MULTIPLIER = 5;

export class DriftScorer {
  /** Points banked this lap. */
  total = 0;
  /** Points accumulating in the live drift. */
  pending = 0;
  /** Current chain multiplier, 1..MAX_MULTIPLIER. */
  multiplier = 1;
  /** Seconds the current drift has run. */
  duration = 0;
  active = false;

  /** Best single drift this session, for the results screen. */
  bestSingle = 0;

  private chainTimer = 0;
  private wasActive = false;

  /** Fired when a drift is banked. `chained` is the multiplier it landed at. */
  onBank: ((points: number, chained: number) => void) | null = null;

  update(dt: number, vehicle: Vehicle): void {
    this.active = vehicle.isDrifting;

    if (this.active) {
      this.duration += dt;
      // Score rate scales with both how sideways and how fast: a slow scandi
      // flick should not out-earn a committed high-speed slide.
      const angleFactor = Math.min(1.6, Math.abs(vehicle.slipAngle) / vehicle.def.driftAngle);
      const speedFactor = Math.min(1.4, vehicle.speed / 28);
      this.pending += dt * 120 * angleFactor * speedFactor;
      this.chainTimer = CHAIN_WINDOW;
    } else {
      if (this.wasActive) this.bank();
      if (this.chainTimer > 0) {
        this.chainTimer -= dt;
        if (this.chainTimer <= 0) this.multiplier = 1;
      }
    }

    // Spinning out or stopping kills the chain immediately — the player should
    // feel the loss, not discover it a second later.
    if (vehicle.speed < 4) {
      this.chainTimer = 0;
      this.multiplier = 1;
      if (this.pending > 0) this.dropPending();
    }

    this.wasActive = this.active;
  }

  private bank(): void {
    // Very short slides are noise from a bumpy surface, not a drift.
    if (this.duration < 0.35 || this.pending < 40) {
      this.dropPending();
      return;
    }
    const points = Math.round(this.pending * this.multiplier);
    this.total += points;
    this.bestSingle = Math.max(this.bestSingle, points);
    this.onBank?.(points, this.multiplier);
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
    this.pending = 0;
    this.duration = 0;
  }

  private dropPending(): void {
    this.pending = 0;
    this.duration = 0;
  }

  /** Called on lap completion; drift score is per-lap like the time. */
  resetLap(): void {
    this.total = 0;
    this.pending = 0;
    this.multiplier = 1;
    this.chainTimer = 0;
    this.duration = 0;
  }

  resetAll(): void {
    this.resetLap();
    this.bestSingle = 0;
    this.active = false;
    this.wasActive = false;
  }
}
