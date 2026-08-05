import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';

/**
 * Tyre smoke and skid marks.
 *
 * Both are fixed-size ring buffers allocated once. Nothing here creates a mesh,
 * geometry or vector per frame — particle systems are the classic place where a
 * browser game starts stuttering from GC, and the drift mechanic means these
 * are emitting almost constantly.
 */

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly opacities: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private head = 0;
  private capacity: number;
  private readonly lastPoint = new Map<number, THREE.Vector3>();

  constructor(settings: QualitySettings) {
    this.capacity = settings.maxSkidSegments;
    // Two triangles per segment, three vertices each.
    this.positions = new Float32Array(this.capacity * 6 * 3);
    this.opacities = new Float32Array(this.capacity * 6);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacities, 1));
    this.geometry.setDrawRange(0, 0);
    // Marks are scattered along the lap; a bounding sphere would cover the
    // whole circuit anyway, so skip the useless cull test.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Marks sit on the road surface; polygon offset avoids z-fighting more
      // cheaply than lifting them and having them float on slopes.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: { uColor: { value: new THREE.Color(0x101014) } },
      vertexShader: /* glsl */ `
        attribute float aOpacity;
        varying float vOpacity;
        void main() {
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vOpacity;
        void main() {
          if (vOpacity <= 0.001) discard;
          gl_FragColor = vec4(uColor, vOpacity * 0.55);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'skid-marks';
  }

  /**
   * Extend the mark for one wheel. `wheelId` keeps each wheel's trail separate
   * so the quad connects to that wheel's previous point, not another wheel's.
   */
  addPoint(wheelId: number, x: number, y: number, z: number, rightX: number, rightZ: number, intensity: number): void {
    const previous = this.lastPoint.get(wheelId);
    if (!previous) {
      this.lastPoint.set(wheelId, new THREE.Vector3(x, y, z));
      return;
    }

    const dx = x - previous.x;
    const dz = z - previous.z;
    const distSq = dx * dx + dz * dz;
    // Below ~12 cm the quad is sub-pixel and just burns buffer slots.
    if (distSq < 0.015) return;
    // A teleport (respawn) must not draw a mark across the whole map.
    if (distSq > 64) {
      previous.set(x, y, z);
      return;
    }

    const halfWidth = 0.16;
    const ox = rightX * halfWidth;
    const oz = rightZ * halfWidth;
    const lift = 0.015;

    const base = this.head * 18;
    const p = this.positions;
    // Triangle 1
    p[base] = previous.x - ox; p[base + 1] = previous.y + lift; p[base + 2] = previous.z - oz;
    p[base + 3] = previous.x + ox; p[base + 4] = previous.y + lift; p[base + 5] = previous.z + oz;
    p[base + 6] = x - ox; p[base + 7] = y + lift; p[base + 8] = z - oz;
    // Triangle 2
    p[base + 9] = previous.x + ox; p[base + 10] = previous.y + lift; p[base + 11] = previous.z + oz;
    p[base + 12] = x + ox; p[base + 13] = y + lift; p[base + 14] = z + oz;
    p[base + 15] = x - ox; p[base + 16] = y + lift; p[base + 17] = z - oz;

    const alpha = Math.min(1, intensity);
    const obase = this.head * 6;
    for (let i = 0; i < 6; i += 1) this.opacities[obase + i] = alpha;

    previous.set(x, y, z);
    this.head = (this.head + 1) % this.capacity;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aOpacity.needsUpdate = true;
    this.geometry.setDrawRange(0, this.capacity * 6);
  }

  /** Called when the wheel stops sliding, so the next mark starts fresh. */
  breakTrail(wheelId: number): void {
    this.lastPoint.delete(wheelId);
  }

  clear(): void {
    this.opacities.fill(0);
    this.head = 0;
    this.lastPoint.clear();
    this.geometry.attributes.aOpacity.needsUpdate = true;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class SmokePuffs {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly velocities: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;

  private head = 0;
  private readonly capacity: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.Texture;

  constructor(settings: QualitySettings) {
    this.capacity = settings.maxParticles;
    this.positions = new Float32Array(this.capacity * 3);
    this.velocities = new Float32Array(this.capacity * 3);
    this.ages = new Float32Array(this.capacity);
    this.lifetimes = new Float32Array(this.capacity);
    this.sizes = new Float32Array(this.capacity);
    this.alphas = new Float32Array(this.capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.texture = makeSmokeTexture();
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: this.texture },
        uColor: { value: new THREE.Color(0xf2f2f5) },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Perspective size attenuation, clamped so near puffs cannot fill
          // the screen on a phone.
          gl_PointSize = clamp(aSize * (300.0 / -mv.z), 2.0, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          float mask = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(uColor, mask * vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'smoke';
  }

  emit(x: number, y: number, z: number, vx: number, vz: number, strength: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;

    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    // Inherit a fraction of the car's motion so smoke trails behind instead of
    // hanging in a suspicious straight line.
    this.velocities[i * 3] = vx * 0.22 + (Math.sin(i * 12.9898) * 0.7);
    this.velocities[i * 3 + 1] = 0.9 + strength * 0.8;
    this.velocities[i * 3 + 2] = vz * 0.22 + (Math.cos(i * 78.233) * 0.7);

    this.ages[i] = 0;
    this.lifetimes[i] = 0.7 + strength * 0.5;
    this.sizes[i] = 1.6 + strength * 2.2;
    this.alphas[i] = Math.min(0.55, 0.2 + strength * 0.35);
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.alphas[i] <= 0.001) continue;
      this.ages[i] += dt;
      const life = this.ages[i] / this.lifetimes[i];
      if (life >= 1) {
        this.alphas[i] = 0;
        continue;
      }
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      // Drag so puffs settle instead of drifting away forever.
      const drag = 1 - Math.min(1, dt * 1.8);
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 2] *= drag;
      this.sizes[i] += dt * 5.5;
      this.alphas[i] *= 1 - Math.min(1, dt * 1.6);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.alphas.fill(0);
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

function makeSmokeTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
