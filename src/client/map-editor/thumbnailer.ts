/**
 * Live thumbnails for the asset picker.
 *
 * The owner's second pain point was "no preview of Placeable Assets": every
 * model choice in this editor was a dropdown of slugs like
 * `world_buildings_houses_firstage_2_level1`, so picking a house meant
 * stamping one, looking, deleting it and trying the next.
 *
 * These are RENDERED rather than baked. A thumbnail step in the asset pipeline
 * would be a second artifact to keep in sync with the models — and it would go
 * stale exactly when a model is re-baked, which is when a wrong picture is most
 * misleading. One small offscreen renderer draws each model once, on demand,
 * and the result is cached for the session.
 *
 * The framing is the part that matters: a fixed camera makes a cathedral and a
 * pebble the same size on screen, so the camera is placed from the model's OWN
 * bounding sphere. That is also why every tile carries its real height in
 * metres — two models that fill their tiles identically can be 0.4 m and 12 m
 * apart, and the picker would be lying by omission without it.
 */

import * as THREE from 'three';

const SIZE = 96;

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

const getRenderer = (): THREE.WebGLRenderer | null => {
  if (renderer) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
  } catch {
    // A box without WebGL still gets a usable picker — names and sizes, no art.
    renderer = null;
  }
  return renderer;
};

/**
 * Draw one model to a PNG data URL. Returns null when WebGL is unavailable.
 *
 * The GLTF's scene is used directly (not cloned): it is added to a throwaway
 * scene, rendered, and removed, so nothing about the shared cached model is
 * mutated — the caller keeps using it for the viewport.
 */
export const thumbnailFor = (ref: string, gltf: { scene: THREE.Object3D }): string | null => {
  const cached = cache.get(ref);
  if (cached) return cached;
  const gl = getRenderer();
  if (!gl) return null;

  const scene = new THREE.Scene();
  const object = gltf.scene;
  const previousParent = object.parent;
  scene.add(object);

  // Light it like the editor viewport rather than flat: a low-poly building
  // with no shading reads as a silhouette, which is not a preview.
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(3, 5, 4);
  scene.add(key);

  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, Math.max(50, sphere.radius * 20));
  // Three-quarter view from slightly above — the angle that shows a roof AND a
  // door, which straight-on and top-down each lose.
  const distance = (sphere.radius || 1) / Math.sin((35 * Math.PI) / 360) / 1.6;
  camera.position.set(
    sphere.center.x + distance * 0.75,
    sphere.center.y + distance * 0.55,
    sphere.center.z + distance * 0.75,
  );
  camera.lookAt(sphere.center);

  gl.render(scene, camera);
  const url = gl.domElement.toDataURL('image/png');

  scene.remove(object);
  if (previousParent) previousParent.add(object);
  cache.set(ref, url);
  return url;
};
