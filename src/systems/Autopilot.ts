import type { Track } from './Track';
import type { Vehicle } from '../entities/Vehicle';
import type { InputIntent } from '../core/InputController';

/**
 * Centreline-following driver.
 *
 * Exists for two reasons, both practical rather than gameplay: it proves every
 * circuit is actually drivable end to end without a human, and it produces the
 * reference lap times that the gold/silver/bronze targets are set from. Guessing
 * those targets and shipping them is how you get a game where gold is either
 * free or impossible.
 *
 * It is deliberately a simple pursuit controller, not a fast racing line — it
 * should represent a competent-but-unremarkable lap, which is the right anchor
 * for a bronze-ish target.
 */
export class Autopilot {
  /** Extra lookahead in metres; larger is smoother but cuts corners later. */
  private readonly baseLookahead = 14;
  private readonly intent: InputIntent = { throttle: 0, steer: 0, handbrake: false };
  private hint = -1;

  constructor(private readonly track: Track) {}

  update(vehicle: Vehicle): InputIntent {
    const samples = this.track.samples;
    const count = samples.length - 1;

    this.hint = this.track.nearestSampleIndex(vehicle.position.x, vehicle.position.z, this.hint);

    // Sample spacing is ~2 m, so index deltas convert to metres directly.
    const spacing = this.track.length / count;
    const speed = vehicle.speed;
    const lookaheadMetres = this.baseLookahead + speed * 0.62;
    const aheadIndex = (this.hint + Math.round(lookaheadMetres / spacing)) % count;
    const target = samples[aheadIndex].position;

    // Steering: signed angle between heading and the bearing to the target.
    const forwardX = Math.sin(vehicle.yaw);
    const forwardZ = Math.cos(vehicle.yaw);
    const toTargetX = target.x - vehicle.position.x;
    const toTargetZ = target.z - vehicle.position.z;
    const length = Math.hypot(toTargetX, toTargetZ) || 1;
    const dirX = toTargetX / length;
    const dirZ = toTargetZ / length;

    // Cross product on the horizontal plane gives the turn direction.
    // Sign matches the right-positive steering convention in Vehicle.
    const cross = forwardX * dirZ - forwardZ * dirX;
    const dot = forwardX * dirX + forwardZ * dirZ;
    const angle = Math.atan2(cross, dot);

    let steer = Math.max(-1, Math.min(1, angle * 2.1));

    // Correct back toward the centre when running wide, so the bot does not
    // settle into a stable orbit along the outside kerb.
    const surface = this.track.sampleSurface(vehicle.position.x, vehicle.position.z, this.hint);
    const lateralError = surface.lateral / surface.halfWidth;
    steer += -lateralError * 0.22;
    steer = Math.max(-1, Math.min(1, steer));

    // Throttle from upcoming curvature: measure how much the track bends over
    // the next braking distance and lift accordingly.
    const brakingIndex = (this.hint + Math.round((18 + speed * 1.1) / spacing)) % count;
    const hereForward = samples[this.hint % count].forward;
    const laterForward = samples[brakingIndex].forward;
    const bend = Math.acos(
      Math.max(-1, Math.min(1, hereForward.x * laterForward.x + hereForward.z * laterForward.z)),
    );

    // Comfortable speed for this bend, in m/s. The constants are empirical:
    // straight -> top speed, 90-degree turn -> about 20 m/s.
    const cornerSpeed = Math.max(14, vehicle.def.topSpeed * (1 - bend * 0.78));

    let throttle: number;
    if (speed > cornerSpeed + 3) {
      throttle = -1;
    } else if (speed > cornerSpeed) {
      throttle = 0;
    } else {
      throttle = 1;
    }

    // Recovery: if we somehow ended up off track and slow, just drive forward
    // rather than braking into a stall.
    if (speed < 6) throttle = 1;

    this.intent.throttle = throttle;
    this.intent.steer = steer;
    this.intent.handbrake = false;
    return this.intent;
  }
}
