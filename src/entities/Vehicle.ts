import * as THREE from 'three';
import type { CarDef } from '../data/cars';
import type { Track } from '../systems/Track';
import type { InputIntent } from '../core/InputController';

/**
 * Custom arcade vehicle model.
 *
 * Deliberately not a rigid-body simulation. The car is a point mass with a
 * heading, and the whole feel comes from one idea: **steering rotates the
 * heading, grip drags the velocity vector toward it.** A drift is simply a
 * large angle between where the car points and where it is going.
 *
 * That split is what makes the handling tunable — `turnRate` owns rotation,
 * `lateralGrip` owns how fast the slide is caught, and the two never fight each
 * other the way a solver-driven rigid body would. It also stays deterministic
 * under a fixed timestep, which lap times and ghost replays depend on.
 */

const GRAVITY = 26;
const RIDE_HEIGHT = 0.42;
/** Linear rolling resistance coefficient, 1/s. Deliberately small. */
const ROLLING_RESISTANCE = 0.02;
/** Engine output retained once the power taper has fully closed, at top speed. */
const TAPER_FLOOR = 0.35;
/** Slip below this is noise, not a drift. */
const MIN_DRIFT_SPEED = 9;
/** How hard the soft barrier pushes back, m/s^2. */
const BARRIER_PUSH = 55;
/** Metres past the tarmac edge before the barrier engages. */
const BARRIER_MARGIN = 2.6;

export interface VehicleSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export class Vehicle {
  readonly def: CarDef;

  // --- simulation state -------------------------------------------------
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  yawRate = 0;
  grounded = true;

  /** Seconds of boost thrust banked from the current or last drift. */
  boost = 0;
  /** How long the current qualifying drift has lasted, seconds. */
  driftTime = 0;
  /** Signed slip angle in radians; drives smoke, scoring and the HUD meter. */
  slipAngle = 0;
  isDrifting = false;
  offTrack = false;
  /** Lap progress in [0,1) from the track spline. */
  progress = 0;
  /** Set for one step when a drift ends and boost is awarded. */
  justBankedBoost = 0;

  /** Cosmetic body lean, integrated separately from the physics state. */
  pitch = 0;
  roll = 0;

  private sampleHint = -1;
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private readonly right = new THREE.Vector3(1, 0, 0);

  /**
   * Quadratic drag coefficient, derived so that full throttle equilibrates at
   * exactly `def.topSpeed`.
   *
   * Deriving it instead of hand-tuning a magic number is what keeps `topSpeed`
   * honest: an earlier build hard-coded the drag terms and every car silently
   * capped at 66 km/h against a 187 km/h spec, because rolling resistance alone
   * out-pulled the engine long before the taper closed.
   */
  private readonly dragK: number;

  /** Previous step's transform, for render interpolation. */
  readonly previous: VehicleSnapshot = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  readonly current: VehicleSnapshot = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };

  constructor(def: CarDef) {
    this.def = def;
    // Solve  engine(topSpeed) = rolling(topSpeed) + drag(topSpeed)  for drag.
    const engineAtTop = def.enginePower * TAPER_FLOOR;
    const rollingAtTop = ROLLING_RESISTANCE * def.topSpeed;
    this.dragK = Math.max(1e-5, (engineAtTop - rollingAtTop) / (def.topSpeed * def.topSpeed));
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Signed forward speed, negative when reversing. */
  get forwardSpeed(): number {
    return this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
  }

  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position);
    this.position.y += RIDE_HEIGHT;
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.boost = 0;
    this.driftTime = 0;
    this.slipAngle = 0;
    this.isDrifting = false;
    this.offTrack = false;
    this.grounded = true;
    this.pitch = 0;
    this.roll = 0;
    this.sampleHint = -1;
    this.updateBasis();
    this.snapshot();
    Object.assign(this.previous, this.current);
  }

  private updateBasis(): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.forward.set(sin, 0, cos);
    // right = up x forward
    this.right.set(cos, 0, -sin);
  }

  private snapshot(): void {
    this.current.x = this.position.x;
    this.current.y = this.position.y;
    this.current.z = this.position.z;
    this.current.yaw = this.yaw;
    this.current.pitch = this.pitch;
    this.current.roll = this.roll;
  }

  /**
   * Advance one fixed step.
   *
   * Order matters and is fixed: read surface -> longitudinal forces -> heading
   * -> lateral grip -> integrate -> resolve ground and barriers.
   */
  fixedUpdate(dt: number, input: InputIntent, track: Track, frozen = false): void {
    Object.assign(this.previous, this.current);

    const def = this.def;
    const surface = track.sampleSurface(this.position.x, this.position.z, this.sampleHint);
    this.sampleHint = track.nearestSampleIndex(this.position.x, this.position.z, this.sampleHint);
    this.progress = surface.progress;
    this.offTrack = surface.offTrack;

    // During the countdown the car is held still but must still sit on the road.
    if (frozen) {
      this.velocity.set(0, 0, 0);
      this.yawRate = 0;
      this.position.y = surface.height + RIDE_HEIGHT;
      this.updateBasis();
      this.snapshot();
      return;
    }

    this.updateBasis();

    const vLong = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
    const vLat = this.velocity.x * this.right.x + this.velocity.z * this.right.z;
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // --- slip / drift state ------------------------------------------------
    // atan2 against |vLong| so reversing does not read as a 180-degree drift.
    this.slipAngle = Math.atan2(vLat, Math.abs(vLong) + 0.001);
    const wasDrifting = this.isDrifting;
    const slidingHard = Math.abs(this.slipAngle) > def.driftAngle;
    this.isDrifting = this.grounded && slidingHard && planarSpeed > MIN_DRIFT_SPEED;

    this.justBankedBoost = 0;
    if (this.isDrifting) {
      this.driftTime += dt;
    } else if (wasDrifting) {
      // Banking on exit (not continuously) is what makes the boost feel earned:
      // you commit to the slide, then get paid when you straighten up.
      const gained = Math.min(this.driftTime * def.boostGain * 0.25, def.boostMax);
      if (this.driftTime > 0.35) {
        this.boost = Math.min(def.boostMax, this.boost + gained);
        this.justBankedBoost = gained;
      }
      this.driftTime = 0;
    }

    // --- longitudinal ------------------------------------------------------
    let longAccel = 0;
    if (this.grounded) {
      const throttle = input.throttle;
      if (throttle > 0) {
        // Power tapers as we approach top speed so acceleration feels like a
        // curve instead of a step into a wall.
        const headroom = Math.max(0, 1 - Math.max(0, vLong) / def.topSpeed);
        longAccel += def.enginePower * throttle * (TAPER_FLOOR + (1 - TAPER_FLOOR) * headroom);
      } else if (throttle < 0) {
        if (vLong > 0.6) {
          longAccel -= def.brakePower * -throttle;
        } else {
          // Reverse is intentionally weak; it exists to recover from a spin,
          // not as a driving mode.
          longAccel += def.enginePower * 0.32 * throttle;
        }
      }

      if (input.handbrake) longAccel -= 9 * Math.sign(vLong);

      // Boost burns down in real time and adds thrust on top of the engine.
      if (this.boost > 0) {
        this.boost = Math.max(0, this.boost - dt);
        longAccel += def.boostPower;
      }

      // Rolling resistance and quadratic drag.
      longAccel -= vLong * ROLLING_RESISTANCE;
      longAccel -= Math.sign(vLong) * (vLong * vLong) * this.dragK;

      if (this.offTrack) {
        // Grass is a real penalty but not a wall: you can cut a corner and pay
        // for it, which keeps the racing line a choice.
        longAccel -= vLong * 2.6;
      }
    }

    // --- heading -----------------------------------------------------------
    if (this.grounded) {
      const speedRatio = Math.min(1, planarSpeed / def.topSpeed);
      // Steering authority falls with speed, otherwise the car spins at 200 kph
      // from a tap. It never reaches zero, or high-speed corrections die.
      const authority = 1 - (1 - def.highSpeedTurnFactor) * speedRatio;
      // Below walking pace there is no steering at all — a stationary car that
      // rotates on the spot looks broken.
      const rolling = Math.min(1, planarSpeed / 3.5);

      let targetYawRate = input.steer * def.turnRate * authority * rolling;
      if (this.isDrifting) targetYawRate *= def.driftYawBoost;
      if (input.handbrake && planarSpeed > 6) targetYawRate *= 1.35;
      // Reversing inverts the steering geometry, as in a real car.
      if (vLong < -0.5) targetYawRate *= -1;

      // Exponential approach is framerate-independent and has no overshoot.
      const blend = 1 - Math.exp(-def.turnResponse * dt);
      this.yawRate += (targetYawRate - this.yawRate) * blend;
    } else {
      // No tyres on the ground, no yaw authority. Bleed off existing rotation.
      this.yawRate *= 1 - Math.min(1, dt * 1.4);
    }

    this.yaw += this.yawRate * dt;
    this.updateBasis();

    // --- lateral grip ------------------------------------------------------
    let latAccel = 0;
    if (this.grounded) {
      let gripLimit = def.lateralGrip;
      if (this.isDrifting) gripLimit *= def.driftGripFactor;
      // The handbrake is the player's deliberate 'break traction now' button;
      // at 0.45 it barely stepped the rear out on the grip car.
      if (input.handbrake) gripLimit *= 0.3;
      if (this.offTrack) gripLimit *= 0.5;

      // Pull the velocity vector back toward the heading, capped by available
      // grip. The cap is the entire drift mechanic: exceed it and the slide
      // persists instead of snapping straight.
      const correction = -vLat * 9;
      latAccel = Math.max(-gripLimit, Math.min(gripLimit, correction));
    }

    // --- integrate ---------------------------------------------------------
    this.velocity.x += (this.forward.x * longAccel + this.right.x * latAccel) * dt;
    this.velocity.z += (this.forward.z * longAccel + this.right.z * latAccel) * dt;

    this.velocity.y -= GRAVITY * dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // --- ground ------------------------------------------------------------
    const after = track.sampleSurface(this.position.x, this.position.z, this.sampleHint);
    const groundY = after.height + RIDE_HEIGHT;
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      if (this.velocity.y < 0) {
        // Landing scrubs a little speed so hard drops off a crest cost time.
        if (!this.grounded && this.velocity.y < -9) {
          this.velocity.x *= 0.94;
          this.velocity.z *= 0.94;
        }
        this.velocity.y = 0;
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // --- soft barrier ------------------------------------------------------
    const overshoot = Math.abs(after.lateral) - (after.halfWidth + BARRIER_MARGIN);
    if (overshoot > 0) {
      const inward = -Math.sign(after.lateral);
      const push = Math.min(1, overshoot / 3) * BARRIER_PUSH;
      this.velocity.x += after.right.x * inward * push * dt;
      this.velocity.z += after.right.z * inward * push * dt;
      // Scrub speed against the wall rather than bouncing, which would fling
      // the player back across the track.
      this.velocity.x *= 0.965;
      this.velocity.z *= 0.965;
    }

    this.updateVisualLean(dt, longAccel, latAccel);
    this.snapshot();
  }

  /**
   * Body lean. Purely cosmetic, but it is most of what sells weight — without
   * it the car reads as a sprite sliding on ice.
   */
  private updateVisualLean(dt: number, longAccel: number, latAccel: number): void {
    const targetPitch = THREE.MathUtils.clamp(-longAccel * 0.006, -0.09, 0.09);
    const targetRoll = THREE.MathUtils.clamp(latAccel * 0.009, -0.16, 0.16);
    const blend = 1 - Math.exp(-9 * dt);
    this.pitch += (targetPitch - this.pitch) * blend;
    this.roll += (targetRoll - this.roll) * blend;
  }

  /** Interpolated transform for rendering between physics steps. */
  interpolate(alpha: number, out: VehicleSnapshot): void {
    const a = this.previous;
    const b = this.current;
    out.x = a.x + (b.x - a.x) * alpha;
    out.y = a.y + (b.y - a.y) * alpha;
    out.z = a.z + (b.z - a.z) * alpha;
    out.yaw = a.yaw + shortestAngle(a.yaw, b.yaw) * alpha;
    out.pitch = a.pitch + (b.pitch - a.pitch) * alpha;
    out.roll = a.roll + (b.roll - a.roll) * alpha;
  }
}

/** Shortest signed delta between two angles, so wrapping never spins the mesh. */
export function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export { RIDE_HEIGHT };
