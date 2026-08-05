/**
 * Lap and sector timing.
 *
 * Progress comes from the track spline, which means a car that turns around and
 * drives backwards over the line does not score a lap. Sector gates must be
 * crossed in order for a lap to validate — the cheapest possible anti-shortcut
 * measure, and enough for a single-player time attack.
 */

export const SECTOR_COUNT = 3;

export interface LapResult {
  time: number;
  sectors: number[];
  valid: boolean;
}

export class LapTimer {
  /** Elapsed time on the current lap, seconds. */
  current = 0;
  /** Completed splits for the lap in progress. */
  readonly sectors: number[] = [];
  /** Best full lap this session, or null. */
  best: LapResult | null = null;
  /** Per-sector best times from the best lap, used for the live delta. */
  bestSectors: number[] | null = null;

  private sectorIndex = 0;
  private lastProgress = 0;
  private running = false;
  private invalidated = false;

  /** Fired whenever a lap closes, valid or not. */
  onLap: ((result: LapResult) => void) | null = null;
  onSector: ((index: number, time: number, delta: number | null) => void) | null = null;

  start(progress: number): void {
    this.current = 0;
    this.sectors.length = 0;
    this.sectorIndex = 0;
    this.lastProgress = progress;
    this.running = true;
    this.invalidated = false;
  }

  stop(): void {
    this.running = false;
  }

  /** Mark the current lap as not counting (used when the player resets). */
  invalidate(): void {
    this.invalidated = true;
  }

  update(dt: number, progress: number): void {
    if (!this.running) return;
    this.current += dt;

    const previous = this.lastProgress;
    this.lastProgress = progress;

    // Wrapping from ~1 back to ~0 is the finish line. Guard on a large negative
    // jump so noise near a sector boundary cannot trigger it.
    const wrapped = previous > 0.8 && progress < 0.2;
    if (wrapped) {
      this.closeSector(progress);
      const result: LapResult = {
        time: this.current,
        sectors: [...this.sectors],
        valid: !this.invalidated && this.sectorIndex >= SECTOR_COUNT,
      };
      if (result.valid && (!this.best || result.time < this.best.time)) {
        this.best = result;
        this.bestSectors = [...result.sectors];
      }
      this.onLap?.(result);
      this.start(progress);
      return;
    }

    // Driving backwards over the line resets nothing but must not advance
    // sectors either.
    if (previous < 0.2 && progress > 0.8) {
      this.invalidate();
      return;
    }

    const nextGate = (this.sectorIndex + 1) / SECTOR_COUNT;
    if (this.sectorIndex < SECTOR_COUNT - 1 && progress >= nextGate && previous < nextGate) {
      this.closeSector(progress);
    }
  }

  private closeSector(_progress: number): void {
    const elapsedBefore = this.sectors.reduce((sum, s) => sum + s, 0);
    const split = this.current - elapsedBefore;
    this.sectors.push(split);
    const index = this.sectorIndex;
    this.sectorIndex += 1;

    let delta: number | null = null;
    if (this.bestSectors && this.bestSectors.length > index) {
      const bestCumulative = this.bestSectors
        .slice(0, index + 1)
        .reduce((sum, s) => sum + s, 0);
      delta = this.current - bestCumulative;
    }
    this.onSector?.(index, split, delta);
  }

  /**
   * Live delta against the best lap, or null when there is nothing to compare.
   * Interpolates within the current sector using lap progress so the number
   * moves continuously instead of only at gates.
   */
  liveDelta(progress: number): number | null {
    if (!this.best || !this.bestSectors) return null;
    const bestTotal = this.best.time;
    // Estimate where the best lap was at this progress by assuming constant
    // pace inside each sector. Good enough for a HUD readout.
    const sectorFloat = progress * SECTOR_COUNT;
    const index = Math.min(SECTOR_COUNT - 1, Math.floor(sectorFloat));
    const withinSector = sectorFloat - index;
    let bestAt = 0;
    for (let i = 0; i < index; i += 1) bestAt += this.bestSectors[i] ?? 0;
    bestAt += (this.bestSectors[index] ?? bestTotal / SECTOR_COUNT) * withinSector;
    return this.current - bestAt;
  }

  reset(): void {
    this.current = 0;
    this.sectors.length = 0;
    this.sectorIndex = 0;
    this.running = false;
    this.invalidated = false;
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '-';
  const abs = Math.abs(delta);
  return `${sign}${abs.toFixed(2)}`;
}
