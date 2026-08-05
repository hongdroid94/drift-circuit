import * as THREE from 'three';
import type { Vehicle, VehicleSnapshot } from '../entities/Vehicle';

/**
 * Chase camera.
 *
 * The one decision that matters: the camera follows the **direction of travel**,
 * not the car's heading. In a drift those differ by 30+ degrees, and a camera
 * locked to the heading would swing to stare at the inside wall exactly when
 * the player needs to see the corner exit. Blending toward velocity keeps the
 * next decision on screen, which is the whole job.
 */

// Tuned against the 15 m-wide first circuit: high and far enough that the next
// corner is on screen before you need to commit to it, close enough that the
// car's rotation during a drift is still readable.
const BASE_DISTANCE = 9.2;
const BASE_HEIGHT = 4.15;
const LOOK_AHEAD = 13;

export class CameraRig {
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();
  private readonly followDir = new THREE.Vector3(0, 0, -1);
  private readonly tmp = new THREE.Vector3();

  private shakeAmount = 0;
  private shakeTime = 0;
  private initialised = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  reset(): void {
    this.initialised = false;
    this.shakeAmount = 0;
  }

  /** Add a positional kick. Used for landings, wall scrapes and boost. */
  shake(amount: number): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
  }

  update(vehicle: Vehicle, view: VehicleSnapshot, dt: number): void {
    const speed = vehicle.speed;
    const speedRatio = Math.min(1, speed / vehicle.def.topSpeed);

    // Direction the camera sits behind. At low speed velocity is noisy or zero,
    // so fall back to the heading.
    const heading = this.tmp.set(Math.sin(view.yaw), 0, Math.cos(view.yaw));
    if (speed > 3.5) {
      const vx = vehicle.velocity.x / speed;
      const vz = vehicle.velocity.z / speed;
      // Mostly travel direction, with some heading so the car does not look
      // like it is being dragged sideways by an invisible rope.
      const blendToVelocity = 0.72;
      heading.set(
        heading.x * (1 - blendToVelocity) + vx * blendToVelocity,
        0,
        heading.z * (1 - blendToVelocity) + vz * blendToVelocity,
      );
      if (heading.lengthSq() > 1e-5) heading.normalize();
    }

    // Ease the follow direction rather than snapping, or a spin whips the view.
    const dirBlend = 1 - Math.exp(-(this.initialised ? 6 : 60) * dt);
    this.followDir.lerp(heading, dirBlend);
    if (this.followDir.lengthSq() > 1e-5) this.followDir.normalize();

    // Pull back and drop slightly as speed rises: more road visible when it
    // matters, tighter framing when parking.
    const distance = BASE_DISTANCE + speedRatio * 2.6;
    const height = BASE_HEIGHT + speedRatio * 0.5;

    this.desired.set(
      view.x - this.followDir.x * distance,
      view.y + height,
      view.z - this.followDir.z * distance,
    );

    if (!this.initialised) {
      this.camera.position.copy(this.desired);
      this.smoothedLook.set(view.x, view.y, view.z);
      this.initialised = true;
    } else {
      // Faster follow at speed keeps the car from sliding to the frame edge.
      const posBlend = 1 - Math.exp(-(7.5 + speedRatio * 5) * dt);
      this.camera.position.lerp(this.desired, posBlend);
    }

    // Look ahead of the car along travel, biased up slightly so the horizon
    // stays visible on crests. Look-ahead grows with speed: at 200 kph the
    // useful information is much further down the road than at 40.
    const ahead = LOOK_AHEAD + speedRatio * 8;
    this.lookTarget.set(
      view.x + this.followDir.x * ahead,
      view.y + 1.6,
      view.z + this.followDir.z * ahead,
    );
    const lookBlend = 1 - Math.exp(-9 * dt);
    this.smoothedLook.lerp(this.lookTarget, lookBlend);
    this.camera.lookAt(this.smoothedLook);

    // Speed FOV. Small numbers on purpose — a big pump reads as a bug.
    const baseFov = this.camera.aspect < 1 ? 78 : 66;
    const targetFov = baseFov + speedRatio * 9 + (vehicle.boost > 0 ? 5 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }

    this.applyShake(dt);
  }

  private applyShake(dt: number): void {
    if (this.shakeAmount <= 0.001) return;
    this.shakeTime += dt * 34;
    const decay = Math.exp(-6 * dt);
    this.shakeAmount *= decay;
    // Deterministic sine noise instead of random: no per-frame allocation and
    // it cannot produce a one-frame spike that reads as a glitch.
    const s = this.shakeAmount;
    this.camera.position.x += Math.sin(this.shakeTime * 1.7) * s * 0.19;
    this.camera.position.y += Math.sin(this.shakeTime * 2.3 + 1.1) * s * 0.14;
    this.camera.position.z += Math.cos(this.shakeTime * 1.9) * s * 0.19;
    if (this.shakeAmount < 0.001) this.shakeAmount = 0;
  }
}
