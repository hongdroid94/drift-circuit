import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { createCarModel } from '../src/entities/CarModel';
import { CARS } from '../src/data/cars';

/**
 * Geometry assertions, no browser needed.
 *
 * These guard a bug class that is invisible to every other test: the car mesh
 * being built facing the wrong way. Nothing crashes, the frame rate is fine,
 * the lap still completes — the car simply drives tail-first, and you only
 * notice by staring at a screenshot.
 *
 * The hull and cabin are extruded from 2D plans and then rotated into place, so
 * their final orientation depends on a chain of rotations that is easy to get
 * backwards. The hand-placed parts (lights, spoiler, wheels) define the
 * convention: +Z is forward. These tests assert the extruded parts agree.
 */

/** Widest |x| found within a slab of the mesh's local Z. */
function halfWidthNearZ(geometry: THREE.BufferGeometry, zMin: number, zMax: number): number {
  const position = geometry.getAttribute('position');
  let widest = 0;
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (z >= zMin && z <= zMax) widest = Math.max(widest, Math.abs(position.getX(i)));
  }
  return widest;
}

test.describe('car model orientation', () => {
  for (const car of CARS) {
    test(`${car.name} hull points the same way as its lights`, () => {
      const model = createCarModel(car);
      const meshes = model.body.children.filter(
        (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true,
      );
      // The hull is the first mesh added and by far the largest.
      const hull = meshes[0];
      expect(hull, 'hull mesh should exist').toBeTruthy();

      const noseHalfWidth = halfWidthNearZ(hull.geometry, 1.6, 3);
      const tailHalfWidth = halfWidthNearZ(hull.geometry, -3, -1.6);

      // Headlights sit at z = +1.92, brake lights at z = -1.94. The car is drawn
      // with a narrow nose and a wide tail, so the nose end must be the narrow
      // one — otherwise the body is 180 degrees out from every other part.
      expect(
        noseHalfWidth,
        `nose half-width ${noseHalfWidth.toFixed(2)} should be narrower than tail ${tailHalfWidth.toFixed(2)}`,
      ).toBeLessThan(tailHalfWidth);

      model.dispose();
    });

    test(`${car.name} steered wheels are the front pair`, () => {
      const model = createCarModel(car);
      for (const pivot of model.steeredWheels) {
        expect(pivot.position.z, 'steered wheels must sit at +Z (front)').toBeGreaterThan(0);
      }
      expect(model.steeredWheels).toHaveLength(2);

      // Brake lights belong at the back.
      expect(model.brakeLights.position.z).toBeLessThan(0);
      // Boost flames come out of the back too.
      expect(model.boostFlames.position.z).toBeLessThan(0);

      model.dispose();
    });
  }
});

/**
 * The basis convention itself, asserted directly.
 *
 * `right` must be `forward x up`. The opposite order yields this system's LEFT,
 * which inverts steering and forces a compensating winding flip in the road
 * mesh — both of which shipped before this test existed.
 */
test('right vector is forward x up, i.e. screen-right for a chase camera', () => {
  const up = new THREE.Vector3(0, 1, 0);

  for (const yaw of [0, Math.PI / 2, -Math.PI / 3, 2.4]) {
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

    const expected = new THREE.Vector3().crossVectors(forward, up).normalize();
    expect(right.distanceTo(expected), `basis mismatch at yaw ${yaw}`).toBeLessThan(1e-6);

    // A camera behind the car looking along +forward has screen-right = (-fz, 0, fx).
    const screenRight = new THREE.Vector3(-forward.z, 0, forward.x);
    expect(right.dot(screenRight), `right should point screen-right at yaw ${yaw}`).toBeGreaterThan(
      0.999,
    );
  }
});

/**
 * Which way a roll angle actually tips the car.
 *
 * `Vehicle` integrates a roll angle from lateral acceleration and `Game`
 * assigns it straight to `body.rotation.z`. Whether that reads as leaning into
 * or out of a corner depends on the model's local axes, which is exactly the
 * kind of sign chain that has already shipped backwards here twice. So it is
 * measured off the built geometry rather than reasoned about.
 *
 * The car's right side is local -X: the shared basis is `right = forward x up`,
 * and at yaw 0 that is (-1, 0, 0) while the model's local axes coincide with
 * world. This test pins the half of the chain that lives in the model; the
 * browser-side lean test pins the sign `Vehicle` feeds in.
 */
test('positive body roll drops the car right side', () => {
  const model = createCarModel(CARS[0]);
  model.body.rotation.z = 0.16;
  model.root.updateMatrixWorld(true);

  const rightSide = model.body.localToWorld(new THREE.Vector3(-1, 0, 0));
  const leftSide = model.body.localToWorld(new THREE.Vector3(1, 0, 0));

  expect(
    rightSide.y,
    `right side y ${rightSide.y.toFixed(3)} should sit below left side y ${leftSide.y.toFixed(3)}`,
  ).toBeLessThan(leftSide.y);

  model.dispose();
});
