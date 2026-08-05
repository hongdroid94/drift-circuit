/**
 * Car definitions.
 *
 * The three cars are not power tiers — they are handling personalities that sit
 * at different points on the same trade-off: how easily the rear steps out, and
 * how much you are paid for it. A grip car is faster for a clean driver; a
 * drift car is faster for someone who links corners.
 */

export interface CarDef {
  id: string;
  name: string;
  blurb: string;
  colors: {
    body: number;
    accent: number;
    glass: number;
  };
  /** Longitudinal acceleration at rest, in m/s^2. */
  enginePower: number;
  /** Soft top speed in m/s (drag balances engine here). */
  topSpeed: number;
  /** Braking deceleration, m/s^2. */
  brakePower: number;
  /** Peak yaw rate at low speed, rad/s. */
  turnRate: number;
  /** Fraction of turnRate still available at top speed. */
  highSpeedTurnFactor: number;
  /** How fast heading responds to steering input, 1/s. Higher is twitchier. */
  turnResponse: number;
  /** Lateral acceleration the tyres can generate before sliding, m/s^2. */
  lateralGrip: number;
  /** Lateral grip retained once sliding. Lower slides further. */
  driftGripFactor: number;
  /** Yaw multiplier while drifting: how much extra rotation the slide gives. */
  driftYawBoost: number;
  /** Slip angle (radians) at which a slide counts as a scoring drift. */
  driftAngle: number;
  /** Boost metres-per-second gained per second of sustained drift. */
  boostGain: number;
  /** Cap on stored boost, in seconds of thrust. */
  boostMax: number;
  /** Extra forward acceleration while boosting, m/s^2. */
  boostPower: number;
  /** Lap time on any track must beat this to unlock the next car. */
  unlock: { trackId: string; seconds: number } | null;
}

export const CARS: CarDef[] = [
  {
    id: 'comet',
    name: 'Comet',
    blurb: 'Grip. Sticks to the line, forgives late braking.',
    colors: { body: 0x2f6ee0, accent: 0xf2f5ff, glass: 0x101823 },
    enginePower: 15.5,
    topSpeed: 52,
    brakePower: 26,
    turnRate: 2.15,
    highSpeedTurnFactor: 0.46,
    turnResponse: 8.5,
    lateralGrip: 15.5,
    driftGripFactor: 0.5,
    driftYawBoost: 1.35,
    driftAngle: 0.26,
    boostGain: 2.4,
    boostMax: 1.5,
    boostPower: 12,
    unlock: null,
  },
  {
    id: 'vortex',
    name: 'Vortex',
    blurb: 'Balanced. Will drift if you ask, grips if you do not.',
    colors: { body: 0x18b97a, accent: 0x0b2f22, glass: 0x0d1a16 },
    enginePower: 16.8,
    topSpeed: 55,
    brakePower: 24,
    turnRate: 2.25,
    highSpeedTurnFactor: 0.48,
    turnResponse: 9.5,
    lateralGrip: 13.5,
    driftGripFactor: 0.4,
    driftYawBoost: 1.6,
    driftAngle: 0.24,
    boostGain: 3.2,
    boostMax: 2,
    boostPower: 14,
    unlock: { trackId: 'sunset-loop', seconds: 25 },
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Drift. Loose rear, huge exit boost. Punishes tidy driving.',
    colors: { body: 0xef4d2e, accent: 0x2a0f0a, glass: 0x1a0c08 },
    enginePower: 17.6,
    topSpeed: 57,
    brakePower: 22,
    turnRate: 2.5,
    highSpeedTurnFactor: 0.54,
    turnResponse: 10.5,
    lateralGrip: 11,
    driftGripFactor: 0.28,
    driftYawBoost: 1.95,
    driftAngle: 0.22,
    boostGain: 4.3,
    boostMax: 2.6,
    boostPower: 17,
    unlock: { trackId: 'ridge-run', seconds: 37 },
  },
];

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}
