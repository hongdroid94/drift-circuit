import type { GhostData } from './Ghost';

/**
 * Progress persistence.
 *
 * localStorage only — no account, no server. Every write is wrapped because
 * portal iframes and private browsing modes can throw on access, and losing a
 * best lap is far better than crashing the game.
 */

const KEY = 'arcade-racer:save:v1';

export interface TrackRecord {
  bestLap: number;
  bestDrift: number;
  ghost: GhostData | null;
}

export interface SaveData {
  version: 1;
  records: Record<string, TrackRecord>;
  unlockedCars: string[];
  selectedCar: string;
  selectedTrack: string;
  quality: 'auto' | 'low' | 'medium' | 'high';
  muted: boolean;
  totalRaces: number;
}

function emptySave(): SaveData {
  return {
    version: 1,
    records: {},
    unlockedCars: ['comet'],
    selectedCar: 'comet',
    selectedTrack: 'sunset-loop',
    quality: 'auto',
    muted: false,
    totalRaces: 0,
  };
}

export class Save {
  private data: SaveData;
  /** False when storage is unavailable; the game still runs, just forgets. */
  readonly persistent: boolean;

  constructor() {
    let loaded: SaveData | null = null;
    let ok = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SaveData;
        if (parsed && parsed.version === 1) loaded = parsed;
      }
    } catch {
      ok = false;
    }
    this.persistent = ok;
    this.data = loaded ?? emptySave();
    // Defensive: a save written by an older build may be missing newer fields.
    this.data = { ...emptySave(), ...this.data };
  }

  get raw(): SaveData {
    return this.data;
  }

  record(trackId: string): TrackRecord {
    return this.data.records[trackId] ?? { bestLap: Infinity, bestDrift: 0, ghost: null };
  }

  bestLap(trackId: string): number {
    const value = this.data.records[trackId]?.bestLap;
    return typeof value === 'number' ? value : Infinity;
  }

  ghost(trackId: string): GhostData | null {
    return this.data.records[trackId]?.ghost ?? null;
  }

  /** Returns true when this lap became the new record. */
  submitLap(trackId: string, time: number, driftScore: number, ghost: GhostData | null): boolean {
    const existing = this.record(trackId);
    const improved = time < existing.bestLap;
    this.data.records[trackId] = {
      bestLap: improved ? time : existing.bestLap,
      bestDrift: Math.max(existing.bestDrift, driftScore),
      // Only keep the ghost of the fastest lap, or storage grows every race.
      ghost: improved ? ghost ?? existing.ghost : existing.ghost,
    };
    this.persist();
    return improved;
  }

  isCarUnlocked(carId: string): boolean {
    return this.data.unlockedCars.includes(carId);
  }

  unlockCar(carId: string): boolean {
    if (this.data.unlockedCars.includes(carId)) return false;
    this.data.unlockedCars.push(carId);
    this.persist();
    return true;
  }

  setSelection(carId: string, trackId: string): void {
    this.data.selectedCar = carId;
    this.data.selectedTrack = trackId;
    this.persist();
  }

  setQuality(quality: SaveData['quality']): void {
    this.data.quality = quality;
    this.persist();
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted;
    this.persist();
  }

  countRace(): number {
    this.data.totalRaces += 1;
    this.persist();
    return this.data.totalRaces;
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota exceeded (ghosts are the only thing that grows). Drop ghosts and
      // retry once so times survive even when replays cannot.
      try {
        for (const record of Object.values(this.data.records)) record.ghost = null;
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch {
        /* give up silently; the session still works in memory */
      }
    }
  }
}
