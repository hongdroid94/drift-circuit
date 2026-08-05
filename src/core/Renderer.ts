import * as THREE from 'three';
import type { QualitySettings } from './Quality';

export function createRenderer(
  canvas: HTMLCanvasElement,
  settings: QualitySettings,
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: settings.antialias,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    // The car is opaque and we always clear; keeping the drawing buffer costs
    // bandwidth on mobile tilers for nothing.
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  applyQuality(renderer, settings);
  return renderer;
}

export function applyQuality(
  renderer: THREE.WebGLRenderer,
  settings: QualitySettings,
): void {
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.needsUpdate = true;
}

/**
 * Resize to the CSS box. Returns true when the drawing buffer actually changed,
 * so callers can refresh anything that depends on aspect ratio.
 */
export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  maxDpr: number,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);

  if (canvas.width === bufferWidth && canvas.height === bufferHeight) {
    return false;
  }

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // Portrait phones get a wider vertical FOV so the road ahead stays visible;
  // otherwise the horizon sits off-screen and the next corner is a surprise.
  camera.fov = camera.aspect < 1 ? 78 : 66;
  camera.updateProjectionMatrix();
  return true;
}
