import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackDef, ScenerySpecies } from '../data/tracks';
import type { Track } from './Track';
import type { QualitySettings } from '../core/Quality';

/**
 * Everything around the road: ground, sky, lighting and scenery.
 *
 * Scenery is the main draw-call risk in the whole game, so every species is a
 * single InstancedMesh built from one merged geometry. A track with 250 props
 * therefore costs 3-4 draw calls, not 250 — which is what keeps the mid-range
 * phone budget reachable.
 */

export class World {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private readonly instanced: THREE.InstancedMesh[] = [];

  constructor(
    private readonly def: TrackDef,
    track: Track,
    scene: THREE.Scene,
    settings: QualitySettings,
  ) {
    const palette = def.palette;

    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.FogExp2(palette.fog, settings.fogDensity);

    this.hemi = new THREE.HemisphereLight(palette.horizon, palette.ground, 1.15);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2df, 2.1);
    this.sun.position.set(60, 90, 40);
    this.sun.castShadow = settings.shadows;
    this.configureShadow(settings);
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.group.add(this.buildSky(palette.sky, palette.horizon));
    this.group.add(this.buildGround(palette.ground));
    this.buildScenery(track, settings);
  }

  private configureShadow(settings: QualitySettings): void {
    const cam = this.sun.shadow.camera;
    // A tight ortho box around the car keeps texel density usable at 1024.
    const extent = 60;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
  }

  applyQuality(settings: QualitySettings, scene: THREE.Scene): void {
    this.sun.castShadow = settings.shadows;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.configureShadow(settings);
    if (scene.fog instanceof THREE.FogExp2) scene.fog.density = settings.fogDensity;
    for (const mesh of this.instanced) {
      mesh.castShadow = settings.shadows;
    }
  }

  /** Keep the shadow frustum centred on the car instead of the world origin. */
  focusShadow(target: THREE.Vector3): void {
    this.sun.position.set(target.x + 55, target.y + 85, target.z + 38);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  private buildSky(sky: number, horizon: number): THREE.Mesh {
    const geom = new THREE.SphereGeometry(900, 16, 10);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(sky) },
        bottomColor: { value: new THREE.Color(horizon) },
      },
      vertexShader: /* glsl */ `
        varying float vH;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vH = normalize(world.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying float vH;
        void main() {
          // Bias the blend toward the horizon so the gradient sits where the
          // player actually looks rather than overhead.
          float t = pow(clamp(vH * 0.5 + 0.5, 0.0, 1.0), 0.65);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
    });
    this.disposables.push(geom, mat);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    mesh.name = 'sky';
    return mesh;
  }

  private buildGround(color: number): THREE.Mesh {
    const geom = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 1,
      metalness: 0,
    });
    this.disposables.push(geom, mat);
    const mesh = new THREE.Mesh(geom, mat);
    // Slightly below zero so it never z-fights with the road ribbon.
    mesh.position.y = -0.06;
    mesh.receiveShadow = true;
    mesh.name = 'ground';
    return mesh;
  }

  private buildScenery(track: Track, settings: QualitySettings): void {
    const rng = mulberry32(this.def.seed);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scaleVec = new THREE.Vector3();
    const posVec = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (const spec of this.def.scenery) {
      const { geometry, material } = buildSpecies(spec.species, this.def.palette.scenery, this.def.palette.accent);
      this.disposables.push(geometry, material);

      const mesh = new THREE.InstancedMesh(geometry, material, spec.count);
      mesh.castShadow = settings.shadows;
      mesh.receiveShadow = false;
      mesh.name = `scenery-${spec.species}`;
      // Instances are scattered around the whole circuit, so a single bounding
      // sphere would be huge; disable culling rather than pay for a wrong test.
      mesh.frustumCulled = false;

      const samples = track.samples;
      for (let i = 0; i < spec.count; i += 1) {
        const sample = samples[Math.floor(rng() * (samples.length - 1))];
        const side = rng() < 0.5 ? -1 : 1;
        const offset = spec.offset[0] + rng() * (spec.offset[1] - spec.offset[0]);
        const scale = spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]);

        posVec.copy(sample.position);
        posVec.x += sample.right.x * offset * side;
        posVec.z += sample.right.z * offset * side;
        // Jitter along the track too, or props line up in visible rows.
        posVec.x += (rng() - 0.5) * 6;
        posVec.z += (rng() - 0.5) * 6;

        quat.setFromAxisAngle(up, rng() * Math.PI * 2);
        scaleVec.set(scale, scale * (0.85 + rng() * 0.4), scale);
        matrix.compose(posVec, quat, scaleVec);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.instanced.push(mesh);
      this.group.add(mesh);
    }
  }

  dispose(): void {
    for (const mesh of this.instanced) mesh.dispose();
    this.instanced.length = 0;
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}

function buildSpecies(
  species: ScenerySpecies,
  sceneryColor: number,
  accentColor: number,
): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  switch (species) {
    case 'tree': {
      const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 5);
      trunk.translate(0, 0.8, 0);
      const canopy = new THREE.ConeGeometry(1.35, 3.4, 6);
      canopy.translate(0, 3.0, 0);
      const merged = mergeGeometries([trunk, canopy], false)!;
      trunk.dispose();
      canopy.dispose();
      // Vertex colours let one material cover trunk and canopy, keeping the
      // whole species at a single draw call.
      paintByHeight(merged, 0x5a3a22, sceneryColor, 1.7);
      return {
        geometry: merged,
        material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
      };
    }
    case 'rock': {
      const geom = new THREE.DodecahedronGeometry(0.9, 0);
      geom.scale(1, 0.72, 1.1);
      geom.translate(0, 0.5, 0);
      return {
        geometry: geom,
        material: new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 1, flatShading: true }),
      };
    }
    case 'sign': {
      const post = new THREE.BoxGeometry(0.11, 1.9, 0.11);
      post.translate(0, 0.95, 0);
      const board = new THREE.BoxGeometry(1.5, 0.72, 0.09);
      board.translate(0, 2.1, 0);
      const merged = mergeGeometries([post, board], false)!;
      post.dispose();
      board.dispose();
      paintByHeight(merged, 0x9aa0a8, accentColor, 1.75);
      return {
        geometry: merged,
        material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true }),
      };
    }
    case 'building':
    default: {
      const base = new THREE.BoxGeometry(4.2, 6.5, 4.2);
      base.translate(0, 3.25, 0);
      const roof = new THREE.BoxGeometry(4.6, 0.4, 4.6);
      roof.translate(0, 6.7, 0);
      const merged = mergeGeometries([base, roof], false)!;
      base.dispose();
      roof.dispose();
      paintByHeight(merged, sceneryColor, accentColor, 6.5);
      return {
        geometry: merged,
        material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }),
      };
    }
  }
}

/** Assign one of two colours per vertex based on height, for merged props. */
function paintByHeight(
  geometry: THREE.BufferGeometry,
  lowColor: number,
  highColor: number,
  splitY: number,
): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const low = new THREE.Color(lowColor);
  const high = new THREE.Color(highColor);
  for (let i = 0; i < position.count; i += 1) {
    const c = position.getY(i) < splitY ? low : high;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Small deterministic PRNG so a track's scenery is identical every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
