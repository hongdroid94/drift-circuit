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
/**
 * How far past the pure-grip yaw limit ordinary steering may push.
 *
 * Exactly 1: steering demands at most the lateral acceleration the tyres can
 * actually deliver, so slip settles at a few degrees and never accumulates.
 * At 1.15 it demanded 15% more grip than existed, which is a small deficit that
 * builds without limit if you simply hold the turn — full lock at 120 km/h
 * reached 22 degrees and tripped a drift the player never asked for.
 *
 * Breaking traction is supposed to cost a deliberate input, so anything above
 * 1 belongs to the handbrake and to sustaining a slide already underway.
 */
const GRIP_YAW_ALLOWANCE = 1;
/** The handbrake is the deliberate "break traction now" input. */
const HANDBRAKE_YAW_ALLOWANCE = 3.2;
/** Multiplier applied to a car's driftYawBoost while a slide is already live. */
const DRIFT_SUSTAIN_ALLOWANCE = 1.25;
/**
 * Restoring acceleration once the car is past the barrier line, m/s^2.
 *
 * Only a nudge now. The barrier's actual job — stopping outward motion — is
 * done by cancelling the outward velocity component, so this no longer has to
 * be large enough to reverse a car on its own.
 */
const BARRIER_PUSH = 14;
/** How much outward speed the barrier gives back as a bounce. Nearly none. */
const BARRIER_RESTITUTION = 0.15;
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
  /** True on any step the soft barrier is shoving the car back toward the road. */
  atBarrier = false;
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
    // right = forward x up.
    //
    // NOT `up x forward`, which is this system's *left*. The chase camera looks
    // along +forward, and a camera looking down +Z has its screen-right on -X;
    // getting this backwards silently inverted steering and forced a
    // compensating triangle-winding flip in the road mesh.
    this.right.set(-cos, 0, sin);
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

    // --- available grip ----------------------------------------------------
    // Computed once, before the heading, because both the yaw clamp and the
    // lateral force have to agree on how much grip there actually is. They used
    // to disagree: the clamp allowed rotation based on the nominal
    // `def.lateralGrip` while the tyres were only delivering a fraction of it.
    // On grass that meant the car was permitted to rotate at twice what it
    // could hold, and once the slide tripped `isDrifting` the grip halved again
    // while the allowance went *up* — measured at 87 degrees of slip from a
    // 35% steering input at 60 km/h. A spin, from clipping the verge.
    let gripLimit = def.lateralGrip;
    if (this.isDrifting) gripLimit *= def.driftGripFactor;
    if (this.offTrack) gripLimit *= 0.5;

    // Grip the car still has to *rotate* with, as opposed to hold a line with.
    //
    // Everything above costs both axles, so it is already counted. The
    // handbrake is different: it locks the rear only, which is the entire
    // reason a handbrake turn rotates the car instead of just slowing it.
    // Charging it against steering too made the clamp cut the yaw rate by 3.3x
    // the moment the player pulled the handbrake, and the starter car could no
    // longer break traction at all — the core mechanic, silently gone.
    const steeringGrip = gripLimit;
    // The handbrake is the player's deliberate 'break traction now' button;
    // at 0.45 it barely stepped the rear out on the grip car.
    if (input.handbrake) gripLimit *= 0.3;

    // --- heading -----------------------------------------------------------
    if (this.grounded) {
      const speedRatio = Math.min(1, planarSpeed / def.topSpeed);
      // Steering authority falls with speed, otherwise the car spins at 200 kph
      // from a tap. It never reaches zero, or high-speed corrections die.
      const authority = 1 - (1 - def.highSpeedTurnFactor) * speedRatio;
      // Below walking pace there is no steering at all — a stationary car that
      // rotates on the spot looks broken.
      const rolling = Math.min(1, planarSpeed / 3.5);

      // Negative because yaw grows toward the car's LEFT: with
      // forward = (sin y, 0, cos y), d(forward)/dy points along -right.
      // Steering input is right-positive, so it enters inverted.
      let targetYawRate = -input.steer * def.turnRate * authority * rolling;
      // Reversing inverts the steering geometry, as in a real car.
      if (vLong < -0.5) targetYawRate *= -1;

      // Clamp the demanded rotation to what the tyres can actually deliver.
      //
      // Holding a steady turn at speed v with yaw rate w needs a lateral
      // acceleration of v*w. Without this clamp the heading rotated at the full
      // steering rate no matter how little grip was left, so full lock at
      // 60 km/h produced 60-89 degrees of slip on every car — a spin, not a
      // drift, and it made the handbrake pointless because steering alone
      // already broke traction.
      //
      // `allowance` is the ratio of demanded lateral acceleration to available
      // grip. At 1 the car corners at exactly the limit and slip settles at a
      // few degrees; above 1 the deficit accumulates and the slide grows. So
      // ordinary steering sits at 1 — no amount of lock or speed alone can
      // break traction — and only a deliberate input goes past it.
      let allowance = GRIP_YAW_ALLOWANCE;
      if (input.handbrake && planarSpeed > 6) allowance = HANDBRAKE_YAW_ALLOWANCE;
      else if (this.isDrifting) allowance = def.driftYawBoost * DRIFT_SUSTAIN_ALLOWANCE;

      // Floor the divisor so the limit does not explode to infinity at a
      // standstill; low-speed rotation is already governed by `rolling`.
      const gripYawLimit = (steeringGrip * allowance) / Math.max(planarSpeed, 7);
      targetYawRate = Math.max(-gripYawLimit, Math.min(gripYawLimit, targetYawRate));

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
    this.atBarrier = overshoot > 0;
    if (overshoot > 0) {
      // Outward track normal at the car.
      const outward = Math.sign(after.lateral);
      const nx = after.right.x * outward;
      const nz = after.right.z * outward;

      // Direction of travel before the barrier touches it, so the heading can
      // be turned by exactly as much as the barrier turns the velocity.
      const travelBefore = Math.atan2(this.velocity.x, this.velocity.z);
      const movingBefore = Math.hypot(this.velocity.x, this.velocity.z) > 2;

      // A wall takes away outward motion; it does not shove the car sideways.
      // This used to add BARRIER_PUSH inward as a raw acceleration — at 55
      // m/s^2 that is several times tyre grip, and the heading has no way to
      // follow it, so every metre of it landed as slip angle. Measured: a
      // 35% steering input at 60 km/h that brushed the verge went from 6.7
      // degrees of slip to 87 within a second of the barrier engaging, and
      // 102 km/h collapsed to 2. Removing the outward component instead
      // bleeds the same energy without inventing lateral velocity.
      const vOut = this.velocity.x * nx + this.velocity.z * nz;
      if (vOut > 0) {
        const scale = vOut * (1 + BARRIER_RESTITUTION);
        this.velocity.x -= nx * scale;
        this.velocity.z -= nz * scale;
      }

      // A gentle restoring nudge on top, so sitting against the barrier eases
      // the car back onto the tarmac rather than parking it in the scenery.
      const push = Math.min(1, overshoot / 3) * BARRIER_PUSH;
      this.velocity.x -= nx * push * dt;
      this.velocity.z -= nz * push * dt;
      // Scrub speed against the wall rather than bouncing, which would fling
      // the player back across the track.
      this.velocity.x *= 0.965;
      this.velocity.z *= 0.965;

      // Turn the car by however much the barrier just turned its travel.
      //
      // Slip angle is the gap between heading and direction of travel, so
      // editing velocity while leaving the heading alone *creates* slip out of
      // nothing — the same defect as clamping yaw against grip the tyres did
      // not have. Measured before this: the step the barrier engaged took slip
      // from 6.7 degrees to 42, and the car was flagged as drifting because it
      // had been shoved, not because the tyres let go.
      //
      // A real car scraping a wall is redirected bodily, so the heading
      // follows the whole rotation rather than a fraction of it.
      const scrapeSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (movingBefore && scrapeSpeed > 2) {
        const travelAfter = Math.atan2(this.velocity.x, this.velocity.z);
        // Wrap to +-pi so the correction takes the short way round.
        const turned = Math.atan2(
          Math.sin(travelAfter - travelBefore),
          Math.cos(travelAfter - travelBefore),
        );
        this.yaw += turned;
        this.updateBasis();
      }
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
    // Negated because the body leans AWAY from the corner: turning right throws
    // the mass left, so the right side rises. Positive `rotation.z` drops the
    // right side (measured in car-model.spec.ts), hence a right-hand turn —
    // positive `latAccel` — has to produce negative roll.
    //
    // This was correct until the coordinate basis was fixed: `right` used to be
    // the car's left, which flipped `latAccel` and cancelled out the missing
    // minus sign here. Fixing the basis left this one leaning into corners.
    const targetRoll = THREE.MathUtils.clamp(-latAccel * 0.009, -0.16, 0.16);
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
