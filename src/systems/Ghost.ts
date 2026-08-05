import * as THREE from 'three';
import type { Vehicle } from '../entities/Vehicle';
import { shortestAngle } from '../entities/Vehicle';

/**
 * Ghost replay of your best lap.
 *
 * Recorded as sampled transforms rather than replayed inputs. Input replay
 * would be smaller and exact, but it only works if the simulation is
 * bit-identical forever — one physics tweak and every stored ghost desyncs into
 * nonsense. Sampling is a few kilobytes and survives balance changes, which
 * matters more for a game that will be tuned after launch.
 */

const SAMPLE_HZ = 20;
const SAMPLE_DT = 1 / SAMPLE_HZ;
/** Stride: x, y, z, yaw. */
const STRIDE = 4;

export interface GhostData {
  /** Lap time the ghost was recorded at. */
  time: number;
  /** Flat [x, y, z, yaw] samples at SAMPLE_HZ. */
  frames: number[];
}

export class GhostRecorder {
  private frames: number[] = [];
  private accumulator = 0;
  private elapsed = 0;
  private recording = false;

  start(): void {
    this.frames = [];
    this.accumulator = 0;
    this.elapsed = 0;
    this.recording = true;
  }

  update(dt: number, vehicle: Vehicle): void {
    if (!this.recording) return;
    this.elapsed += dt;
    this.accumulator += dt;
    // Cap length so a player who parks for ten minutes cannot grow the buffer
    // without bound.
    if (this.frames.length > SAMPLE_HZ * STRIDE * 60 * 5) {
      this.recording = false;
      return;
    }
    while (this.accumulator >= SAMPLE_DT) {
      this.accumulator -= SAMPLE_DT;
      this.frames.push(
        round(vehicle.position.x, 2),
        round(vehicle.position.y, 2),
        round(vehicle.position.z, 2),
        round(vehicle.yaw, 3),
      );
    }
  }

  /** Finish the recording. Returns null when nothing usable was captured. */
  finish(lapTime: number): GhostData | null {
    this.recording = false;
    if (this.frames.length < STRIDE * 4) return null;
    return { time: lapTime, frames: this.frames };
  }
}

export class GhostPlayer {
  private data: GhostData | null = null;
  private time = 0;
  private playing = false;

  readonly mesh: THREE.Group;
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor() {
    this.mesh = new THREE.Group();
    this.mesh.visible = false;
    this.buildMesh();
  }

  private buildMesh(): void {
    // Deliberately a simplified, translucent silhouette rather than a copy of
    // the player car: it must be readable as "not solid" at a glance so nobody
    // brakes for it.
    const bodyGeom = new THREE.BoxGeometry(1.7, 0.78, 3.9);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const body = new THREE.Mesh(bodyGeom, mat);
    body.position.y = 0.5;
    this.mesh.add(body);

    const edges = new THREE.EdgesGeometry(bodyGeom);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xd6f0ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const outline = new THREE.LineSegments(edges, lineMat);
    outline.position.y = 0.5;
    this.mesh.add(outline);

    this.disposables.push(bodyGeom, mat, edges, lineMat);
  }

  load(data: GhostData | null): void {
    this.data = data;
    this.mesh.visible = false;
    this.playing = false;
  }

  get hasGhost(): boolean {
    return this.data !== null;
  }

  start(): void {
    if (!this.data) return;
    this.time = 0;
    this.playing = true;
    this.mesh.visible = true;
  }

  stop(): void {
    this.playing = false;
    this.mesh.visible = false;
  }

  update(dt: number): void {
    if (!this.playing || !this.data) return;
    this.time += dt;

    const frames = this.data.frames;
    const count = frames.length / STRIDE;
    const exact = this.time / SAMPLE_DT;
    const i = Math.floor(exact);

    if (i >= count - 1) {
      // Ghost finished its lap before us; park it rather than snapping to the
      // start, which would look like a second car appearing.
      this.mesh.visible = false;
      this.playing = false;
      return;
    }

    const alpha = exact - i;
    const a = i * STRIDE;
    const b = a + STRIDE;

    this.mesh.position.set(
      frames[a] + (frames[b] - frames[a]) * alpha,
      frames[a + 1] + (frames[b + 1] - frames[a + 1]) * alpha,
      frames[a + 2] + (frames[b + 2] - frames[a + 2]) * alpha,
    );
    const yawA = frames[a + 3];
    this.mesh.rotation.y = yawA + shortestAngle(yawA, frames[b + 3]) * alpha;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.mesh.clear();
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
