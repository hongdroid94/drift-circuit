import * as THREE from 'three';
import type { TrackDef } from '../data/tracks';

/**
 * A closed spline circuit plus the spatial queries the rest of the game needs.
 *
 * Everything the car asks the world ("how high is the ground here?", "am I off
 * track?", "how far around the lap am I?") is answered analytically from the
 * spline rather than by raycasting against the road mesh. With one car and a
 * static circuit, a nearest-sample lookup over a uniform grid is both cheaper
 * and more stable than casting rays at triangles — and it cannot fall through
 * the road on a slow frame.
 */

export interface TrackSample {
  position: THREE.Vector3;
  /** Unit tangent, pointing in the racing direction. */
  forward: THREE.Vector3;
  /** Unit vector pointing to the right-hand edge of the road. */
  right: THREE.Vector3;
  /** Distance along the centreline from the start line. */
  distance: number;
  halfWidth: number;
}

export interface SurfaceQuery {
  /** Ground height at the queried point. */
  height: number;
  /** Signed distance from the centreline; negative is left, positive is right. */
  lateral: number;
  /** Half width of the road at this point. */
  halfWidth: number;
  /** Normalised lap progress in [0,1). */
  progress: number;
  /** True when the point is beyond the paved surface. */
  offTrack: boolean;
  forward: THREE.Vector3;
  right: THREE.Vector3;
}

const GRID_CELL = 24;

export class Track {
  readonly def: TrackDef;
  readonly curve: THREE.CatmullRomCurve3;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly group = new THREE.Group();

  /** Cell key -> sample indices, for O(1)-ish nearest lookups. */
  private readonly grid = new Map<string, number[]>();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(def: TrackDef) {
    this.def = def;

    const points = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);

    // ~2 m between samples: fine enough that linear interpolation between
    // neighbours is invisible, coarse enough to keep the grid small.
    const approxLength = this.curve.getLength();
    const sampleCount = Math.max(64, Math.round(approxLength / 2));
    this.buildSamples(sampleCount);
    this.length = this.samples[this.samples.length - 1].distance;
    this.buildGrid();
    this.buildMeshes();
  }

  private buildSamples(count: number): void {
    const up = new THREE.Vector3(0, 1, 0);
    let distance = 0;
    let previous: THREE.Vector3 | null = null;

    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      const position = this.curve.getPointAt(t);
      const forward = this.curve.getTangentAt(t).normalize();
      // Right-hand vector on the horizontal plane. Using world up rather than
      // the Frenet normal keeps the road from rolling on steep sections.
      //
      // MUST be `up x forward`, matching Vehicle's basis. The opposite order
      // yields the left vector, which silently flips the road ribbon's triangle
      // winding and backface-culls the entire track.
      const right = new THREE.Vector3().crossVectors(up, forward).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);

      if (previous) distance += position.distanceTo(previous);
      previous = position;

      this.samples.push({
        position,
        forward,
        right,
        distance,
        halfWidth: this.widthAt(t) * 0.5,
      });
    }

    // Close the loop distance so progress wraps cleanly.
    const closing = this.samples[0].position.distanceTo(
      this.samples[this.samples.length - 1].position,
    );
    this.samples.push({
      ...this.samples[0],
      distance: distance + closing,
    });
  }

  /** Road width can vary along the lap so corners can be widened or pinched. */
  private widthAt(t: number): number {
    const { width, widthVariation } = this.def;
    if (!widthVariation) return width;
    const wave = Math.sin(t * Math.PI * 2 * widthVariation.frequency);
    return width + wave * widthVariation.amount;
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`;
  }

  private buildGrid(): void {
    for (let i = 0; i < this.samples.length; i += 1) {
      const { position, halfWidth } = this.samples[i];
      // Register the sample in every cell its road area can touch, so a query
      // from anywhere on the tarmac finds it in its own cell.
      const reach = halfWidth + GRID_CELL;
      const minX = Math.floor((position.x - reach) / GRID_CELL);
      const maxX = Math.floor((position.x + reach) / GRID_CELL);
      const minZ = Math.floor((position.z - reach) / GRID_CELL);
      const maxZ = Math.floor((position.z + reach) / GRID_CELL);
      for (let cx = minX; cx <= maxX; cx += 1) {
        for (let cz = minZ; cz <= maxZ; cz += 1) {
          const key = `${cx},${cz}`;
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  /** Index of the centreline sample nearest to a world position. */
  nearestSampleIndex(x: number, z: number, hint = -1): number {
    // Frame coherence: the car moves a couple of metres per step, so the
    // previous index is almost always within a short window. Check that first
    // and skip the grid entirely in the common case.
    if (hint >= 0) {
      const window = 12;
      let best = -1;
      let bestDist = Infinity;
      for (let offset = -window; offset <= window; offset += 1) {
        const i = (hint + offset + this.samples.length) % this.samples.length;
        const p = this.samples[i].position;
        const dx = p.x - x;
        const dz = p.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      // Only trust the local search when we landed comfortably inside the
      // window; otherwise the car teleported (reset, respawn) and we need the
      // global lookup.
      if (best >= 0 && bestDist < (GRID_CELL * 2) ** 2) return best;
    }

    const bucket = this.grid.get(this.cellKey(x, z));
    let best = -1;
    let bestDist = Infinity;

    const search = bucket ?? null;
    if (search) {
      for (const i of search) {
        const p = this.samples[i].position;
        const dx = p.x - x;
        const dz = p.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
    }

    if (best >= 0) return best;

    // Far outside the circuit (fell off the world): brute force so we always
    // return something sane to respawn against.
    for (let i = 0; i < this.samples.length; i += 1) {
      const p = this.samples[i].position;
      const dx = p.x - x;
      const dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return Math.max(0, best);
  }

  /**
   * Surface information at a world point.
   *
   * Projects the point onto the segment between the nearest sample and its
   * better-matching neighbour, which keeps height and lateral offset smooth
   * instead of stepping at every sample boundary.
   */
  sampleSurface(x: number, z: number, hint = -1): SurfaceQuery {
    const count = this.samples.length - 1;
    // The array carries a duplicate closing sample at index `count`; fold it
    // back to 0 so it is never used as the *current* sample, which would make
    // its neighbours wrong.
    const i = this.nearestSampleIndex(x, z, hint) % count;
    const current = this.samples[i];

    const next = this.samples[(i + 1) % count];
    const prev = this.samples[(i - 1 + count) % count];

    // Pick the neighbour we are actually between.
    const toPoint = this.tmpA.set(x - current.position.x, 0, z - current.position.z);
    const alongNext = this.tmpB
      .set(next.position.x - current.position.x, 0, next.position.z - current.position.z);
    const useNext = toPoint.dot(alongNext) >= 0;
    const other = useNext ? next : prev;

    const segment = this.tmpB
      .set(other.position.x - current.position.x, 0, other.position.z - current.position.z);
    const segLenSq = segment.lengthSq();
    let s = segLenSq > 1e-6 ? toPoint.dot(segment) / segLenSq : 0;
    s = Math.min(1, Math.max(0, s));

    const height = current.position.y + (other.position.y - current.position.y) * s;
    const halfWidth = current.halfWidth + (other.halfWidth - current.halfWidth) * s;

    const forward = current.forward.clone().lerp(other.forward, s).normalize();
    const right = current.right.clone().lerp(other.right, s).normalize();

    // Signed lateral offset from the interpolated centreline point.
    const centreX = current.position.x + (other.position.x - current.position.x) * s;
    const centreZ = current.position.z + (other.position.z - current.position.z) * s;
    const lateral = (x - centreX) * right.x + (z - centreZ) * right.z;

    // Distance must be interpolated wrap-aware. Naively lerping toward the
    // neighbour breaks at the start/finish seam, where the next sample's
    // distance is 0 rather than `length`: progress then slides 0.99 -> 0.5 -> 0
    // across the last two metres instead of jumping, and the lap-complete test
    // (previous > 0.8 && progress < 0.2) never sees a crossing. Shifting the
    // delta by a lap restores a monotonic sweep that wraps in one step.
    let delta = other.distance - current.distance;
    const half = this.length * 0.5;
    if (delta > half) delta -= this.length;
    else if (delta < -half) delta += this.length;

    const distance = current.distance + delta * s;
    const progress = ((distance / this.length) % 1 + 1) % 1;

    return {
      height,
      lateral,
      halfWidth,
      progress,
      offTrack: Math.abs(lateral) > halfWidth,
      forward,
      right,
    };
  }

  /** Grid-space start position and heading for spawning. */
  startTransform(): { position: THREE.Vector3; yaw: number } {
    const first = this.samples[0];
    const position = first.position.clone();
    const yaw = Math.atan2(first.forward.x, first.forward.z);
    return { position, yaw };
  }

  private buildMeshes(): void {
    const count = this.samples.length - 1;

    const roadPositions: number[] = [];
    const roadNormals: number[] = [];
    const roadUvs: number[] = [];
    const roadIndices: number[] = [];

    const curbPositions: number[] = [];
    const curbNormals: number[] = [];
    const curbUvs: number[] = [];
    const curbIndices: number[] = [];

    const CURB_WIDTH = 0.9;
    const ROAD_LIFT = 0.02;

    for (let i = 0; i <= count; i += 1) {
      const sample = this.samples[i % count];
      const { position, right, halfWidth, distance } = sample;
      const y = position.y + ROAD_LIFT;

      const lx = position.x - right.x * halfWidth;
      const lz = position.z - right.z * halfWidth;
      const rx = position.x + right.x * halfWidth;
      const rz = position.z + right.z * halfWidth;

      roadPositions.push(lx, y, lz, rx, y, rz);
      roadNormals.push(0, 1, 0, 0, 1, 0);
      // v repeats every 8 m so the tarmac detail does not stretch on long straights.
      roadUvs.push(0, distance / 8, 1, distance / 8);

      const olx = position.x - right.x * (halfWidth + CURB_WIDTH);
      const olz = position.z - right.z * (halfWidth + CURB_WIDTH);
      const orx = position.x + right.x * (halfWidth + CURB_WIDTH);
      const orz = position.z + right.z * (halfWidth + CURB_WIDTH);

      curbPositions.push(lx, y, lz, olx, y - 0.05, olz, rx, y, rz, orx, y - 0.05, orz);
      curbNormals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      // Alternating red/white blocks come from the u coordinate in the shader-free
      // material below; 1.5 m per block reads well at racing speed.
      const block = distance / 1.5;
      curbUvs.push(0, block, 1, block, 0, block, 1, block);
    }

    for (let i = 0; i < count; i += 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      roadIndices.push(a, c, b, b, c, d);

      const ca = i * 4;
      curbIndices.push(ca, ca + 1, ca + 4, ca + 1, ca + 5, ca + 4);
      curbIndices.push(ca + 2, ca + 6, ca + 3, ca + 3, ca + 6, ca + 7);
    }

    const roadGeom = new THREE.BufferGeometry();
    roadGeom.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeom.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeom.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeom.setIndex(roadIndices);
    roadGeom.computeBoundingSphere();

    const roadMat = new THREE.MeshStandardMaterial({
      color: this.def.palette.road,
      roughness: 0.92,
      metalness: 0,
    });

    const road = new THREE.Mesh(roadGeom, roadMat);
    road.receiveShadow = true;
    road.name = 'road';
    this.group.add(road);
    this.disposables.push(roadGeom, roadMat);

    const curbGeom = new THREE.BufferGeometry();
    curbGeom.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
    curbGeom.setAttribute('normal', new THREE.Float32BufferAttribute(curbNormals, 3));
    curbGeom.setAttribute('uv', new THREE.Float32BufferAttribute(curbUvs, 2));
    curbGeom.setIndex(curbIndices);
    curbGeom.computeBoundingSphere();

    const curbMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0,
      map: makeCurbTexture(),
    });

    const curbs = new THREE.Mesh(curbGeom, curbMat);
    curbs.receiveShadow = true;
    curbs.name = 'curbs';
    this.group.add(curbs);
    this.disposables.push(curbGeom, curbMat);
    if (curbMat.map) this.disposables.push(curbMat.map as unknown as THREE.Material);

    this.group.add(this.buildStartLine());
  }

  private buildStartLine(): THREE.Mesh {
    const sample = this.samples[0];
    const geom = new THREE.PlaneGeometry(sample.halfWidth * 2, 2.2);
    const mat = new THREE.MeshStandardMaterial({
      map: makeStartLineTexture(),
      roughness: 0.8,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(sample.position);
    mesh.position.y += 0.03;
    mesh.rotation.z = -Math.atan2(sample.forward.x, sample.forward.z);
    mesh.receiveShadow = true;
    mesh.name = 'start-line';
    this.disposables.push(geom, mat);
    return mesh;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.group.clear();
    this.grid.clear();
  }
}

/** Red/white curb stripes, drawn once into a tiny canvas texture. */
function makeCurbTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#d92b2b';
  ctx.fillRect(0, 0, size, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeStartLineTexture(): THREE.Texture {
  // 20 columns across a ~15 m road puts each square at roughly 0.75 m, which is
  // the scale a real start line reads at from the cockpit.
  const cols = 20;
  const rows = 3;
  const cell = 16;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#efefef';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#16171b';
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
