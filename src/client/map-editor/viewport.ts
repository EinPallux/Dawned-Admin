/**
 * The map editor viewport (A2-c · MAP_EDITOR.md §1–§2).
 *
 * Game-parity rendering, on purpose: chunk meshes come from the SAME
 * `buildChunkGeometryData` the game client uses (`@dawned/shared`), lit the same
 * way, with the same water and the same ocean backdrop. What the owner sculpts
 * here is what players will see — an editor with its own look is an editor that
 * lies about the result.
 *
 * Everything here is imperative three.js behind a small class, deliberately
 * outside React: a 60 FPS render loop and a per-frame brush preview do not
 * belong in a component tree. React owns the chrome; this owns the canvas.
 */

import * as THREE from 'three';
import { disposeObjectView } from './placement.js';
import {
  CHUNK_SIZE_M,
  CHUNK_VERTS,
  SPLAT_LAYERS,
  WORLD_ORIGIN_M,
  WORLD_SIZE_M,
  buildChunkGeometryData,
} from '@dawned/shared';

/** Palette as linear RGB, the form the shared geometry builder blends in. */
const LAYER_RGB = SPLAT_LAYERS.map((layer) => {
  const color = new THREE.Color(layer.color);
  return [color.r, color.g, color.b] as const;
});

/** Overlays the O picker cycles (MAP_EDITOR.md §3). */
export type OverlayKind = 'none' | 'slope' | 'walkable' | 'splat' | 'height';

/** The world plane zone geometry lives on (y = 0). */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * The tag a draggable gizmo mesh carries on its `userData`, so `pickHandle`
 * can answer "which part of which thing is under the cursor?" without the
 * viewport knowing what a zone corner is.
 */
export interface GizmoHandle {
  kind: string;
  index: number;
}

export interface ViewportChunk {
  cx: number;
  cy: number;
  heights: Float32Array;
  splat: Uint8Array;
  waterLevel: number | null;
  enabled: boolean;
}

/** Slope in degrees at a grid vertex, from its 4-neighbour height differences. */
export const slopeAtVertex = (heights: Float32Array, ix: number, iz: number): number => {
  const at = (x: number, z: number): number =>
    heights[
      Math.min(CHUNK_VERTS - 1, Math.max(0, z)) * CHUNK_VERTS +
        Math.min(CHUNK_VERTS - 1, Math.max(0, x))
    ]!;
  const spacing = CHUNK_SIZE_M / (CHUNK_VERTS - 1);
  const dx = (at(ix + 1, iz) - at(ix - 1, iz)) / (2 * spacing);
  const dz = (at(ix, iz + 1) - at(ix, iz - 1)) / (2 * spacing);
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
};

/** >50° is Steep to the walkgrid — the same threshold the bake uses. */
const STEEP_DEG = 50;

/** The editor's own working light, restored when an ambience preview ends. */
export const EDITOR_LIGHT = { sun: 2.0, hemi: 1.1 };

/**
 * Recolor a chunk's vertex colors for an overlay. Returns null for 'none' (the
 * caller then keeps the splat colors the shared builder produced).
 */
const overlayColors = (
  chunk: ViewportChunk,
  overlay: OverlayKind,
  seaLevel: number,
  base: Float32Array,
): Float32Array | null => {
  if (overlay === 'none' || overlay === 'splat') return null;
  const out = new Float32Array(base.length);
  const gridCount = CHUNK_VERTS * CHUNK_VERTS;
  for (let iz = 0; iz < CHUNK_VERTS; iz++) {
    for (let ix = 0; ix < CHUNK_VERTS; ix++) {
      const i = iz * CHUNK_VERTS + ix;
      const height = chunk.heights[i]!;
      const slope = slopeAtVertex(chunk.heights, ix, iz);
      let r = 0;
      let g = 0;
      let b = 0;
      if (overlay === 'slope') {
        // Green → amber → red across 0…60°, so "is this climbable" reads at a
        // glance instead of needing a number.
        const t = Math.min(1, slope / 60);
        r = Math.min(1, t * 2);
        g = Math.min(1, 2 - t * 2);
        b = 0.12;
      } else if (overlay === 'walkable') {
        const water = (chunk.waterLevel ?? seaLevel) - height;
        if (water > 0.05) {
          r = 0.16;
          g = 0.45;
          b = 0.85; // water: enterable, wade or swim
        } else if (slope > STEEP_DEG) {
          r = 0.85;
          g = 0.17;
          b = 0.2; // steep: blocked
        } else {
          r = 0.2;
          g = 0.78;
          b = 0.32; // walkable
        }
      } else {
        // height: a banded ramp, sea level marked by the band edge
        const t = Math.min(1, Math.max(0, (height - seaLevel) / 60));
        const band = Math.floor(t * 8) / 8;
        r = 0.2 + band * 0.75;
        g = 0.28 + band * 0.6;
        b = 0.55 - band * 0.4;
      }
      out[i * 3] = r;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = b;
    }
  }
  // Skirt vertices copy their source colors — they are the same 4 border rows.
  for (let i = gridCount; i < base.length / 3; i++) {
    out[i * 3] = out[(i % gridCount) * 3] ?? 0.3;
    out[i * 3 + 1] = out[(i % gridCount) * 3 + 1] ?? 0.3;
    out[i * 3 + 2] = out[(i % gridCount) * 3 + 2] ?? 0.3;
  }
  return out;
};

const terrainMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
});

/** Disabled chunks render as a translucent ghost: present, clearly not world. */
const ghostMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
});

const waterMaterial = new THREE.MeshLambertMaterial({
  color: '#2e6e9e',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

interface ChunkView {
  mesh: THREE.Mesh;
  water: THREE.Mesh | null;
  /** Splat colors as built — kept so overlays can be toggled off again. */
  splatColors: Float32Array;
}

export interface ViewportOptions {
  canvas: HTMLCanvasElement;
  seaLevel: number;
  /** Called on every camera change so the status bar can show coordinates. */
  onCameraMoved?: (position: THREE.Vector3) => void;
}

export class MapViewport {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly chunks = new Map<string, ChunkView>();
  private readonly terrainGroup = new THREE.Group();
  private readonly gizmoGroup = new THREE.Group();
  /** Placed objects (A3). Separate from terrain so picking can ask for one or
   * the other: clicking a spawner must select it, not sculpt the hill under it. */
  private readonly objectGroup = new THREE.Group();
  private readonly objectViews = new Map<string, THREE.Object3D>();
  private readonly gridHelper: THREE.LineSegments;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private overlay: OverlayKind = 'none';
  private seaLevel: number;
  private raf = 0;
  private disposed = false;
  private readonly onCameraMoved: ((position: THREE.Vector3) => void) | undefined;

  constructor(options: ViewportOptions) {
    this.seaLevel = options.seaLevel;
    this.onCameraMoved = options.onCameraMoved;
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor('#101318');

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6000);
    this.camera.position.set(0, 180, 220);
    this.camera.lookAt(0, 0, 0);

    // Editor lighting is deliberately flatter than the game's: a low sun makes
    // long shadows that hide the shape you are sculpting. Held as fields so the
    // zone ambience preview can borrow them and hand them back.
    this.sun = new THREE.DirectionalLight('#fff3e0', EDITOR_LIGHT.sun);
    this.sun.position.set(0.5, 1, 0.35).multiplyScalar(300);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight('#dce8ff', '#3a4a3a', EDITOR_LIGHT.hemi);
    this.scene.add(this.hemi);

    this.scene.add(this.terrainGroup);
    this.scene.add(this.objectGroup);
    this.scene.add(this.gizmoGroup);
    this.scene.add(buildOcean(this.seaLevel));
    this.gridHelper = buildChunkGrid();
    this.gridHelper.visible = false;
    this.scene.add(this.gridHelper);

    this.renderLoop();
  }

  // --- chunk lifecycle ------------------------------------------------------

  /** Add or replace one chunk's meshes. Cheap enough to call per brush stroke. */
  setChunk(chunk: ViewportChunk): void {
    const key = `${chunk.cx}_${chunk.cy}`;
    this.removeChunk(chunk.cx, chunk.cy);
    const baseX = WORLD_ORIGIN_M + chunk.cx * CHUNK_SIZE_M;
    const baseZ = WORLD_ORIGIN_M + chunk.cy * CHUNK_SIZE_M;
    const data = buildChunkGeometryData(chunk, LAYER_RGB, baseX | 0, baseZ | 0);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors.slice(), 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, chunk.enabled ? terrainMaterial : ghostMaterial);
    mesh.position.set(baseX, 0, baseZ);
    mesh.userData = { cx: chunk.cx, cy: chunk.cy };
    this.terrainGroup.add(mesh);

    let water: THREE.Mesh | null = null;
    if (chunk.waterLevel !== null && chunk.enabled) {
      const plane = new THREE.PlaneGeometry(CHUNK_SIZE_M, CHUNK_SIZE_M);
      plane.rotateX(-Math.PI / 2);
      plane.translate(CHUNK_SIZE_M / 2, 0, CHUNK_SIZE_M / 2);
      water = new THREE.Mesh(plane, waterMaterial);
      water.position.set(baseX, chunk.waterLevel, baseZ);
      this.terrainGroup.add(water);
    }

    const view: ChunkView = { mesh, water, splatColors: data.colors };
    this.chunks.set(key, view);
    if (this.overlay !== 'none') this.applyOverlay(chunk, view);
  }

  removeChunk(cx: number, cy: number): void {
    const key = `${cx}_${cy}`;
    const view = this.chunks.get(key);
    if (!view) return;
    this.terrainGroup.remove(view.mesh);
    view.mesh.geometry.dispose();
    if (view.water) {
      this.terrainGroup.remove(view.water);
      view.water.geometry.dispose();
    }
    this.chunks.delete(key);
  }

  clearChunks(): void {
    for (const key of [...this.chunks.keys()]) {
      const [cx, cy] = key.split('_').map(Number);
      this.removeChunk(cx!, cy!);
    }
  }

  // --- overlays -------------------------------------------------------------

  setOverlay(overlay: OverlayKind, chunkLookup: (cx: number, cy: number) => ViewportChunk | null) {
    this.overlay = overlay;
    this.gridHelper.visible = overlay === 'splat';
    for (const [key, view] of this.chunks) {
      const [cx, cy] = key.split('_').map(Number);
      const chunk = chunkLookup(cx!, cy!);
      if (!chunk) continue;
      this.applyOverlay(chunk, view);
    }
  }

  setChunkGridVisible(visible: boolean): void {
    this.gridHelper.visible = visible;
  }

  private applyOverlay(chunk: ViewportChunk, view: ChunkView): void {
    const attribute = view.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const next = overlayColors(chunk, this.overlay, this.seaLevel, view.splatColors);
    (attribute.array as Float32Array).set(next ?? view.splatColors);
    attribute.needsUpdate = true;
  }

  // --- placed objects -------------------------------------------------------

  /** Replace one object's view (or remove it when `view` is null). */
  setObjectView(id: string, view: THREE.Object3D | null): void {
    const existing = this.objectViews.get(id);
    if (existing) {
      this.objectGroup.remove(existing);
      disposeObjectView(existing);
      this.objectViews.delete(id);
    }
    if (view) {
      this.objectViews.set(id, view);
      this.objectGroup.add(view);
    }
  }

  /** The drawn view of a placed object, if it has one on screen. */
  viewOf(id: string): THREE.Object3D | null {
    return this.objectViews.get(id) ?? null;
  }

  clearObjectViews(): void {
    for (const id of [...this.objectViews.keys()]) this.setObjectView(id, null);
  }

  /**
   * Isolation (MAP_EDITOR.md §3): show only these objects, or everything when
   * `ids` is null. Applied on top of layer visibility rather than replacing it
   * — a hidden layer stays hidden while isolating, which is what "hidden"
   * means.
   */
  private isolation: ReadonlySet<string> | null = null;

  setIsolation(ids: ReadonlySet<string> | null): void {
    this.isolation = ids;
    for (const [id, view] of this.objectViews) {
      view.visible = this.visibilityOf(id, view);
    }
  }

  private visibilityOf(id: string, view: THREE.Object3D): boolean {
    const layer = (view.userData as { layer?: string }).layer ?? '';
    if (this.hiddenLayers.has(layer)) return false;
    return this.isolation === null || this.isolation.has(id);
  }

  /**
   * Every object whose marker projects inside a screen rect — the marquee.
   *
   * Projects the view's own position rather than the stored x/z: a marker
   * stands up from the ground, and selecting by the point you would click is
   * the only version that matches what the owner sees.
   */
  objectsInRect(
    rect: { x0: number; y0: number; x1: number; y1: number },
    bounds: { left: number; top: number; width: number; height: number },
    accept: (id: string) => boolean,
  ): string[] {
    const out: string[] = [];
    const point = new THREE.Vector3();
    for (const [id, view] of this.objectViews) {
      if (!view.visible || !accept(id)) continue;
      new THREE.Box3().setFromObject(view).getCenter(point);
      const projected = point.project(this.camera);
      if (projected.z > 1) continue; // behind the camera
      const x = bounds.left + ((projected.x + 1) / 2) * bounds.width;
      const y = bounds.top + ((1 - projected.y) / 2) * bounds.height;
      if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) out.push(id);
    }
    return out;
  }

  private readonly hiddenLayers = new Set<string>();

  /** Per-layer visibility — the layers panel's hide toggle. */
  setLayerVisible(layer: string, visible: boolean): void {
    if (visible) this.hiddenLayers.delete(layer);
    else this.hiddenLayers.add(layer);
    for (const [id, view] of this.objectViews) {
      const data = view.userData as { layer?: string };
      if (data.layer === layer) view.visible = this.visibilityOf(id, view);
    }
  }

  // --- picking --------------------------------------------------------------

  private readonly raycaster = new THREE.Raycaster();

  /**
   * The id of the placed object under the cursor, or null. Checked BEFORE the
   * terrain pick by every placement tool: a click that lands on a marker means
   * "select this", not "put another one behind it".
   */
  pickObject(ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    // A zone is drawn as a LINE, and three's default 1 m pick threshold is
    // roughly one pixel from map height — selecting a zone border would be a
    // pixel-hunt. Widen it with distance so the grab area stays a few pixels.
    this.raycaster.params.Line = { threshold: Math.max(1, this.camera.position.y / 120) };
    const hits = this.raycaster.intersectObjects(this.objectGroup.children, true);
    // Solid markers beat outlines. A zone border runs across the whole map and
    // with the widened threshold above it grabs clicks several pixels away —
    // so a shrine standing on a border would select the ZONE, and the next
    // thing the owner presses is Delete. You clicked the thing that stands
    // there, not the line passing behind it.
    return this.ownerOf(hits, false) ?? this.ownerOf(hits, true);
  }

  /** First hit that is (or is not) a line, resolved to the object it belongs to. */
  private ownerOf(hits: readonly THREE.Intersection[], lines: boolean): string | null {
    for (const hit of hits) {
      if (hit.object instanceof THREE.Line !== lines) continue;
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const data = node.userData as { objectId?: string };
        if (typeof data.objectId === 'string') return data.objectId;
        node = node.parent;
      }
    }
    return null;
  }

  /**
   * The gizmo handle under the cursor, or null.
   *
   * `GizmoHandle` is the tag a draggable gizmo mesh puts on its `userData` —
   * see `zone-edit.ts` for the only producer today.
   *
   * Checked BEFORE `pickObject` by the zone tool: a vertex handle sits on top
   * of the polygon it edits, so "select the zone" would always win and the
   * corners would be undraggable.
   */
  pickHandle(ndcX: number, ndcY: number): GizmoHandle | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.gizmoGroup.children, true);
    for (const hit of hits) {
      const handle = (hit.object.userData as { handle?: GizmoHandle }).handle;
      if (handle) return handle;
    }
    return null;
  }

  /**
   * World point under normalised device coordinates, or null when the ray
   * misses every chunk. Used by every tool — the brush, the placement gizmo and
   * the ruler all ask the same question.
   */
  pick(ndcX: number, ndcY: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.terrainGroup.children, false);
    for (const hit of hits) {
      // Water planes are not sculptable ground; skip to the terrain under them.
      if (hit.object instanceof THREE.Mesh && hit.object.material === waterMaterial) continue;
      return hit.point;
    }
    return null;
  }

  /**
   * Where the cursor ray crosses the world plane, ignoring terrain entirely.
   *
   * Zones are 2D shapes on that plane and they legitimately extend past the
   * coast — all three shipped zones reach 620 m out, well into open water. So
   * zone authoring cannot require ground under the cursor: with only a terrain
   * pick, a corner over the sea (or over a chunk that has not streamed) is a
   * corner you can see and cannot touch.
   */
  pickPlane(ndcX: number, ndcY: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(GROUND_PLANE, hit) ? hit : null;
  }

  // --- gizmos ---------------------------------------------------------------

  /** Anything transient the tools draw (brush ring, selection, measurements). */
  addGizmo(object: THREE.Object3D): void {
    this.gizmoGroup.add(object);
  }

  removeGizmo(object: THREE.Object3D): void {
    this.gizmoGroup.remove(object);
  }

  // --- frame ----------------------------------------------------------------

  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private renderLoop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.renderLoop);
    this.scaleMarkers();
    this.renderer.render(this.scene, this.camera);
    this.onCameraMoved?.(this.camera.position);
  };

  /**
   * Keep placed-object markers big enough to see and click from map height.
   *
   * A prop is a 1.2 m box; from 500 m up that is under a pixel, so the thing
   * you just placed is invisible and unclickable — you cannot select what you
   * cannot see. Markers therefore grow with camera distance up to a floor,
   * while their RINGS stay true-size, because a ring is a number the owner is
   * deciding and lying about it would be worse than a small marker.
   */
  private scaleMarkers(): void {
    const distance = this.camera.position.y;
    const scale = Math.max(1, distance / 90);
    for (const view of this.objectViews.values()) this.rescale(view, scale);
    // Gizmos follow the same rule: a zone's vertex handles have to stay
    // grabbable from the height you judge a coastline at, or editing a polygon
    // means zooming in on every corner in turn.
    for (const gizmo of this.gizmoGroup.children) this.rescale(gizmo, scale);
  }

  private rescale(view: THREE.Object3D, scale: number): void {
    const marker = view.userData as { markerScale?: number };
    if (marker.markerScale === scale) return;
    marker.markerScale = scale;
    for (const child of view.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const base = (child.userData as { baseScale?: number[] }).baseScale;
      if (!base) continue;
      child.scale.set(base[0]! * scale, base[1]! * scale, base[2]! * scale);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearChunks();
    this.clearObjectViews();
    this.renderer.dispose();
  }
}

// --- static scenery ---------------------------------------------------------

const buildOcean = (seaLevel: number): THREE.Mesh => {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE_M * 3, WORLD_SIZE_M * 3);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: '#22506f', transparent: true, opacity: 0.9 }),
  );
  mesh.position.y = seaLevel - 0.15;
  return mesh;
};

/** One line per chunk boundary across the whole world, drawn at sea level. */
const buildChunkGrid = (): THREE.LineSegments => {
  const points: number[] = [];
  const min = WORLD_ORIGIN_M;
  const max = WORLD_ORIGIN_M + WORLD_SIZE_M;
  for (let at = min; at <= max; at += CHUNK_SIZE_M) {
    points.push(at, 0.2, min, at, 0.2, max);
    points.push(min, 0.2, at, max, 0.2, at);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: '#5d7a94', transparent: true, opacity: 0.5 }),
  );
};
