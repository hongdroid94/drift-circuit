import * as THREE from 'three';
import type { CarDef } from '../data/cars';

/**
 * Procedural low-poly car.
 *
 * Built in code rather than loaded from a free asset pack on purpose: the CC0
 * kits everyone uses are instantly recognisable, and a portal curator sees
 * dozens of games made from them. Extruded silhouettes cost us nothing at
 * runtime, keep the download tiny, and let each car read as a distinct
 * personality (wedge / coupe / muscle) that matches its handling.
 */

export interface CarModelParts {
  root: THREE.Group;
  /** Yaw-only container so body lean does not fight the steering visual. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  steeredWheels: THREE.Mesh[];
  brakeLights: THREE.Mesh;
  boostFlames: THREE.Mesh;
  dispose: () => void;
}

type Profile = 'wedge' | 'coupe' | 'muscle';

const PROFILES: Record<string, Profile> = {
  comet: 'wedge',
  vortex: 'coupe',
  ember: 'muscle',
};

export function createCarModel(def: CarDef): CarModelParts {
  const disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const profile = PROFILES[def.id] ?? 'coupe';

  const paint = new THREE.MeshStandardMaterial({
    color: def.colors.body,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: def.colors.accent,
    roughness: 0.5,
    metalness: 0.1,
    flatShading: true,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: def.colors.glass,
    roughness: 0.12,
    metalness: 0.55,
    flatShading: true,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x15161a,
    roughness: 0.95,
    metalness: 0,
  });
  const rim = new THREE.MeshStandardMaterial({
    color: 0xc9ccd4,
    roughness: 0.4,
    metalness: 0.7,
    flatShading: true,
  });
  disposables.push(paint, accent, glass, rubber, rim);

  // --- hull -------------------------------------------------------------
  const hullGeom = buildHull(profile);
  const hull = new THREE.Mesh(hullGeom, paint);
  hull.castShadow = true;
  hull.receiveShadow = false;
  body.add(hull);
  disposables.push(hullGeom);

  // Roof is painted body colour and the glass is a separate wedge at the front.
  // A cabin made entirely of dark glass reads as a black blob from behind,
  // which is exactly the angle the player spends the whole race looking at.
  const cabinGeom = buildCabin(profile);
  const cabin = new THREE.Mesh(cabinGeom, paint);
  cabin.castShadow = true;
  body.add(cabin);
  disposables.push(cabinGeom);

  const screenGeom = new THREE.BoxGeometry(1.02, 0.46, 0.09);
  const windscreen = new THREE.Mesh(screenGeom, glass);
  windscreen.position.set(0, 0.86, 0.62);
  windscreen.rotation.x = -0.62;
  body.add(windscreen);
  disposables.push(screenGeom);

  const rearScreenGeom = new THREE.BoxGeometry(1.06, 0.34, 0.08);
  const rearScreen = new THREE.Mesh(rearScreenGeom, glass);
  rearScreen.position.set(0, 0.88, profile === 'wedge' ? -1.02 : -0.9);
  rearScreen.rotation.x = 0.55;
  body.add(rearScreen);
  disposables.push(rearScreenGeom);

  // Side windows, so the greenhouse does not float on a solid slab.
  const sideGeom = new THREE.BoxGeometry(0.06, 0.3, 1.15);
  for (const side of [-0.53, 0.53]) {
    const window = new THREE.Mesh(sideGeom, glass);
    window.position.set(side, 0.86, -0.14);
    body.add(window);
  }
  disposables.push(sideGeom);

  // Roof/deck stripe reads at a distance and makes the rotation legible while
  // drifting, when the silhouette alone is ambiguous.
  const stripeGeom = new THREE.BoxGeometry(0.28, 0.03, 3.1);
  const stripe = new THREE.Mesh(stripeGeom, accent);
  stripe.position.set(0, profile === 'muscle' ? 0.78 : 0.72, -0.1);
  body.add(stripe);
  disposables.push(stripeGeom);

  // --- spoiler ----------------------------------------------------------
  const spoilerHeight = profile === 'muscle' ? 0.62 : 0.5;
  const wingGeom = new THREE.BoxGeometry(1.86, 0.07, 0.42);
  const wing = new THREE.Mesh(wingGeom, accent);
  wing.position.set(0, spoilerHeight + 0.3, -1.72);
  wing.castShadow = true;
  body.add(wing);
  disposables.push(wingGeom);

  const strutGeom = new THREE.BoxGeometry(0.09, 0.32, 0.1);
  for (const side of [-0.72, 0.72]) {
    const strut = new THREE.Mesh(strutGeom, accent);
    strut.position.set(side, spoilerHeight + 0.14, -1.72);
    body.add(strut);
  }
  disposables.push(strutGeom);

  // --- lights -----------------------------------------------------------
  const headGeom = new THREE.BoxGeometry(0.42, 0.12, 0.08);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xffe9a8,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });
  disposables.push(headGeom, headMat);
  for (const side of [-0.58, 0.58]) {
    const light = new THREE.Mesh(headGeom, headMat);
    light.position.set(side, 0.44, 1.92);
    body.add(light);
  }

  const brakeGeom = new THREE.BoxGeometry(1.42, 0.11, 0.07);
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x8c1f1f,
    emissive: 0xff2a1a,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const brakeLights = new THREE.Mesh(brakeGeom, brakeMat);
  brakeLights.position.set(0, 0.5, -1.94);
  body.add(brakeLights);
  disposables.push(brakeGeom, brakeMat);

  // Boost flare, hidden until the player cashes in a drift.
  const flameGeom = new THREE.ConeGeometry(0.24, 1.1, 6, 1, true);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x8ad6ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const boostFlames = new THREE.Mesh(flameGeom, flameMat);
  boostFlames.rotation.x = Math.PI / 2;
  boostFlames.position.set(0, 0.34, -2.35);
  boostFlames.visible = false;
  body.add(boostFlames);
  disposables.push(flameGeom, flameMat);

  // --- wheels -----------------------------------------------------------
  const wheelRadius = 0.38;
  const tyreGeom = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 12);
  tyreGeom.rotateZ(Math.PI / 2);
  const rimGeom = new THREE.BoxGeometry(0.32, 0.34, 0.34);
  disposables.push(tyreGeom, rimGeom);

  const wheels: THREE.Mesh[] = [];
  const steeredWheels: THREE.Mesh[] = [];
  const halfTrack = 0.86;
  const wheelbase = 1.28;

  for (const [ix, iz] of [
    [-halfTrack, wheelbase],
    [halfTrack, wheelbase],
    [-halfTrack, -wheelbase],
    [halfTrack, -wheelbase],
  ] as Array<[number, number]>) {
    // A pivot per wheel keeps steering rotation (on the pivot) independent from
    // roll rotation (on the tyre), so they compose instead of interfering.
    const pivot = new THREE.Group();
    pivot.position.set(ix, wheelRadius, iz);
    body.add(pivot);

    const tyre = new THREE.Mesh(tyreGeom, rubber);
    tyre.castShadow = true;
    pivot.add(tyre);

    const hub = new THREE.Mesh(rimGeom, rim);
    tyre.add(hub);

    wheels.push(tyre);
    if (iz > 0) steeredWheels.push(pivot as unknown as THREE.Mesh);
  }

  return {
    root,
    body,
    wheels,
    steeredWheels,
    brakeLights,
    boostFlames,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}

/**
 * Top-down hull silhouette, extruded vertically then squashed.
 *
 * Extruding the *plan* rather than the side profile keeps the wheel arches and
 * nose taper in one shape, which is what makes it read as a car instead of a
 * box with a windscreen.
 */
function buildHull(profile: Profile): THREE.BufferGeometry {
  const noseWidth = profile === 'wedge' ? 0.42 : 0.55;
  const tailWidth = profile === 'muscle' ? 0.92 : 0.82;
  const length = 2.05;

  // Both ends are flat edges, not points. A silhouette that tapers to a single
  // vertex front and rear reads as a boat hull from the chase camera — the flat
  // tail in particular is what makes it look like a car.
  const shape = new THREE.Shape();
  shape.moveTo(-noseWidth, length);
  shape.lineTo(noseWidth, length);
  shape.lineTo(0.9, length - 0.62);
  shape.lineTo(0.98, 0.62);
  shape.lineTo(0.96, -0.55);
  shape.lineTo(0.99, -length + 0.62);
  shape.lineTo(tailWidth, -length);
  shape.lineTo(-tailWidth, -length);
  shape.lineTo(-0.99, -length + 0.62);
  shape.lineTo(-0.96, -0.55);
  shape.lineTo(-0.98, 0.62);
  shape.lineTo(-0.9, length - 0.62);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: profile === 'muscle' ? 0.58 : 0.5,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.08,
    bevelSegments: 1,
    steps: 1,
  });

  // Extrusion runs along +Z; stand it up so depth becomes height.
  geom.rotateX(-Math.PI / 2);
  // That rotation maps the shape's +y to world -Z, so the nose we drew at +y
  // lands at the BACK. Everything else on the car (headlights, spoiler, steered
  // wheels) is authored with +Z as forward, so spin the hull to match — without
  // this the car drives tail-first.
  geom.rotateY(Math.PI);
  geom.translate(0, 0.24, 0);
  geom.computeVertexNormals();
  return geom;
}

function buildCabin(profile: Profile): THREE.BufferGeometry {
  const backRake = profile === 'wedge' ? -1.18 : -1.02;

  // Trapezoid tapering toward the front, like a real greenhouse in plan view.
  const shape = new THREE.Shape();
  shape.moveTo(-0.46, 0.72);
  shape.lineTo(0.46, 0.72);
  shape.lineTo(0.56, 0.1);
  shape.lineTo(0.54, backRake + 0.3);
  shape.lineTo(0.4, backRake);
  shape.lineTo(-0.4, backRake);
  shape.lineTo(-0.54, backRake + 0.3);
  shape.lineTo(-0.56, 0.1);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: profile === 'muscle' ? 0.34 : 0.3,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
    steps: 1,
  });

  geom.rotateX(-Math.PI / 2);
  // Same reversal as the hull: put the windscreen end at +Z.
  geom.rotateY(Math.PI);
  geom.translate(0, 0.66, 0.05);
  geom.computeVertexNormals();
  return geom;
}
