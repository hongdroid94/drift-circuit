/**
 * Render quality tiers.
 *
 * The Poki/CrazyGames technical bar is "at least 30 FPS on mid-range phones
 * released in the last three years, for 85% of users". We cannot know the
 * device up front, so we start from a coarse guess and then auto-demote based
 * on measured FPS during the first seconds of play.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  /** Upper bound on devicePixelRatio. The single biggest mobile fill-rate lever. */
  maxDpr: number;
  antialias: boolean;
  /** Real-time shadow map; when false we fall back to cheap blob shadows. */
  shadows: boolean;
  shadowMapSize: number;
  /** Draw distance for scenery instances, in metres. */
  sceneryDistance: number;
  /** Max simultaneous smoke puffs. */
  maxParticles: number;
  /** Skid mark segment budget. */
  maxSkidSegments: number;
  fogDensity: number;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    maxDpr: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    sceneryDistance: 130,
    maxParticles: 48,
    maxSkidSegments: 120,
    fogDensity: 0.0075,
  },
  medium: {
    tier: 'medium',
    maxDpr: 1.5,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    sceneryDistance: 220,
    maxParticles: 96,
    maxSkidSegments: 260,
    fogDensity: 0.0055,
  },
  high: {
    tier: 'high',
    maxDpr: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    sceneryDistance: 340,
    maxParticles: 160,
    maxSkidSegments: 420,
    fogDensity: 0.004,
  },
};

export function settingsFor(tier: QualityTier): QualitySettings {
  return TIERS[tier];
}

export function isProbablyMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

/** Coarse first guess before we have any FPS samples. */
export function guessInitialTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  if (isProbablyMobile()) {
    return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  }
  if (cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}

/**
 * Watches FPS and demotes the tier when the device cannot hold the target.
 *
 * Deliberately one-way (demote only): a user who dropped to `low` because of a
 * heavy moment should not get yanked back up and stutter again. Promotion
 * happens only on an explicit manual override.
 */
export class QualityManager {
  private sampleTime = 0;
  private sampleFrames = 0;
  private lowFpsStreak = 0;
  /** Grace period so first-frame shader compilation does not trigger a demote. */
  private warmup = 2.5;
  private locked = false;

  constructor(
    private tier: QualityTier,
    private readonly onChange: (settings: QualitySettings) => void,
  ) {}

  get current(): QualitySettings {
    return settingsFor(this.tier);
  }

  /** Manual override from the settings menu. Stops all automatic demotion. */
  setManual(tier: QualityTier): void {
    this.locked = true;
    if (tier === this.tier) return;
    this.tier = tier;
    this.onChange(this.current);
  }

  update(frameDelta: number): void {
    if (this.locked) return;
    if (this.warmup > 0) {
      this.warmup -= frameDelta;
      return;
    }

    this.sampleTime += frameDelta;
    this.sampleFrames += 1;
    if (this.sampleTime < 1) return;

    const fps = this.sampleFrames / this.sampleTime;
    this.sampleTime = 0;
    this.sampleFrames = 0;

    // 50 is the demote trigger, not 30: we want headroom above the contractual
    // floor, because the worst moments (full grid of particles, heavy corner)
    // are not what the average samples.
    if (fps < 50) {
      this.lowFpsStreak += 1;
    } else {
      this.lowFpsStreak = 0;
    }

    if (this.lowFpsStreak >= 3) {
      this.lowFpsStreak = 0;
      if (this.tier === 'high') {
        this.tier = 'medium';
        this.onChange(this.current);
      } else if (this.tier === 'medium') {
        this.tier = 'low';
        this.onChange(this.current);
      }
    }
  }
}
