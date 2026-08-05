/**
 * Map Editor (A2-c/A2-d · MAP_EDITOR.md §1–§3).
 *
 * React owns the chrome — toolbar, tool options, layers, status bar — and the
 * canvas is handed to `MapViewport`, which runs its own loop. The two meet in
 * one ref-held `EditorSession`: a plain object holding the viewport, the camera
 * rig, the draft store and the undo journal, created once on mount. Putting any
 * of that in React state would re-render the world sixty times a second.
 *
 * The lock is enforced by the server on every write; the UI mirrors it so the
 * owner knows BEFORE they sculpt for ten minutes that they are read-only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as THREE from 'three';
import {
  BRUSH_FALLOFFS,
  BrushKind,
  CHUNK_SIZE_M,
  SPLAT_LAYERS,
  WORLD_CHUNKS,
  WORLD_ORIGIN_M,
  chunkIndexOf,
  type BrushFalloff,
} from '@dawned/shared';
import type { AdminUser } from '../../shared-ext/api-types.js';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '../api.js';
import { MapViewport, type OverlayKind } from './viewport.js';
import { CameraRig, type CameraMode, type CameraState } from './cameras.js';
import { DraftStore, type SaveState } from './draft-store.js';
import {
  DEFAULT_BRUSH,
  DEFAULT_PAINT,
  UndoJournal,
  applyBrush,
  applyPaint,
  StrokeClock,
  setChunkEnabled,
  setWaterLevel,
  type BrushSettings,
  type PaintSettings,
} from './tools.js';
import {
  DEFAULT_EROSION,
  DEFAULT_ISLAND,
  autoSplat,
  defaultAutoSplatRules,
  erode,
  generateIsland,
  type IslandSettings,
} from './generators.js';
import { PublishPanel } from './PublishPanel.js';
import { ObjectStore, mintId } from './object-store.js';
import { LAYER_COLOR, buildObjectView, type PlacedObject } from './placement.js';
import { zoneAmbienceSchema } from '@dawned/shared';
import {
  DEFAULT_AMBIENCE,
  ZoneSketch,
  applyAmbiencePreview,
  normalisePolygon,
  zoneDrawProblems,
} from './zones.js';
import { EDITOR_LIGHT } from './viewport.js';
import { ObjectInspector } from './ObjectInspector.js';
import { LAYER_LABEL, PLACEABLE_LAYERS, newObjectDef, type PlaceableLayer } from './new-object.js';

type ToolId = 'sculpt' | 'paint' | 'water' | 'board' | 'place' | 'zone' | 'measure';

interface LockState {
  heldBy: string | null;
  mine: boolean;
  expiresInMs: number;
  takeoverRequestedBy: string | null;
}

interface EditorSession {
  viewport: MapViewport;
  rig: CameraRig;
  store: DraftStore;
  objects: ObjectStore;
  journal: UndoJournal;
  brushRing: THREE.Line;
  measureLine: THREE.Line;
  sketch: ZoneSketch;
  slots: Map<number, CameraState>;
}

/**
 * How much of the world to keep resident, as a chunk radius around the camera
 * pivot, derived from how far back the camera is.
 *
 * A map editor's two jobs want opposite answers: sculpting wants a handful of
 * chunks and 60 FPS, laying out a coastline wants the whole island on screen.
 * Tying the radius to the boom length gives both — pull back and the world
 * fills in, dive in and nothing more is fetched.
 */
const loadRadiusFor = (cameraDistance: number): number =>
  Math.min(MAX_LOAD_RADIUS, Math.max(3, Math.ceil(cameraDistance / 90)));

/**
 * Ceiling on the resident ring. 6 → 13×13 chunks → 832 m across, which is
 * wider than the whole dev island, at ~3.4 M triangles. Going further was
 * measured, not guessed: 17×17 buries a software renderer completely and puts
 * a real GPU at 7.5 M triangles a frame for terrain nobody is editing. The
 * whole-world view is the baked world map, not 1024 live chunks.
 */
const MAX_LOAD_RADIUS = 6;

export const MapEditorPage = ({ user }: { user: AdminUser }): React.JSX.Element => {
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);

  const [tool, setTool] = useState<ToolId>('sculpt');
  const [brush, setBrush] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [paint, setPaint] = useState<PaintSettings>(DEFAULT_PAINT);
  const [overlay, setOverlay] = useState<OverlayKind>('none');
  const [showGrid, setShowGrid] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [saveDetail, setSaveDetail] = useState('');
  const [cursor, setCursor] = useState<{ x: number; z: number; y: number | null } | null>(null);
  const [undoDepth, setUndoDepth] = useState({ canUndo: false, canRedo: false, label: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [island, setIsland] = useState<IslandSettings>(DEFAULT_ISLAND);
  const [showGenerators, setShowGenerators] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [measure, setMeasure] = useState<{ from: THREE.Vector3; to: THREE.Vector3 } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [placeLayer, setPlaceLayer] = useState<PlaceableLayer>('prop');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [objects, setObjects] = useState<PlacedObject[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(() => new Set());
  const [sketchLength, setSketchLength] = useState(0);
  const [previewZone, setPreviewZone] = useState(false);

  // Tool settings are read inside imperative pointer handlers that are
  // registered once; refs keep them current without re-registering listeners.
  // Synced in an effect rather than during render — a ref write in the render
  // body is a side effect, and React is allowed to render twice.
  const toolRef = useRef(tool);
  const brushRef = useRef(brush);
  const paintRef = useRef(paint);
  const placeLayerRef = useRef(placeLayer);
  const lockRef = useRef<LockState | null>(null);
  useEffect(() => {
    toolRef.current = tool;
    brushRef.current = brush;
    paintRef.current = paint;
    placeLayerRef.current = placeLayer;
  }, [tool, brush, paint, placeLayer]);

  /**
   * Say something. The toast fades, the status-bar line does NOT: "imported 271
   * chunks" is a result the owner may want to read after looking away, and a
   * message that only exists for three seconds is a message that gets missed.
   */
  /** The object the inspector and the ambience preview are looking at. */
  const selected = objects.find((object) => object.id === selectedId) ?? null;

  const say = useCallback((message: string) => {
    setToast(message);
    setLastAction(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 3200);
  }, []);

  // --- session bootstrap ----------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewport = new MapViewport({ canvas, seaLevel: 0 });
    const rig = new CameraRig(viewport.camera);
    const journal = new UndoJournal(() => {
      setUndoDepth({
        canUndo: journal.canUndo,
        canRedo: journal.canRedo,
        label: journal.undoLabel ?? '',
      });
    });
    const store = new DraftStore({
      onChunkChanged: (chunk) => {
        viewport.setChunk(chunk);
      },
      onSaveState: (state, detail) => {
        setSaveState(state);
        setSaveDetail(detail ?? '');
      },
    });

    const ringGeometry = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 65 }, (_, i) => {
        const angle = (i / 64) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      }),
    );
    const brushRing = new THREE.Line(
      ringGeometry,
      new THREE.LineBasicMaterial({ color: '#ffd479', depthTest: false }),
    );
    brushRing.renderOrder = 10;
    brushRing.visible = false;
    viewport.addGizmo(brushRing);

    const measureLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#7fd4ff', depthTest: false }),
    );
    measureLine.renderOrder = 10;
    measureLine.visible = false;
    viewport.addGizmo(measureLine);

    // Placed objects. Views are rebuilt from the store on every change; the
    // ground lookup answers null for un-streamed terrain, so a marker is simply
    // not drawn rather than seated on the sea floor (the P8 vendor bug).
    const objectStore = new ObjectStore({
      onChanged: () => {
        setObjects(objectStore.all());
      },
      onError: (message) => {
        setToast(message);
        setLastAction(message);
      },
    });

    const sketch = new ZoneSketch();
    viewport.addGizmo(sketch.line);

    const session: EditorSession = {
      viewport,
      rig,
      store,
      objects: objectStore,
      journal,
      brushRing,
      measureLine,
      sketch,
      slots: new Map(),
    };
    sessionRef.current = session;
    void objectStore.load().catch(() => undefined);

    // The rig only needs a per-frame tick for fly movement; piggy-backing on
    // rAF here keeps the viewport ignorant of input.
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      rig.update();
    };
    tick();

    const resize = (): void => {
      const wrap = wrapRef.current;
      if (wrap) viewport.resize(wrap.clientWidth, wrap.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (wrapRef.current) observer.observe(wrapRef.current);

    // Open over the middle of the world, looking DOWN at it. The first thing
    // the editor shows has to be the island; a default rig aimed at y=0 with a
    // 240 m boom starts inside the first hill it meets, which reads as broken.
    rig.frame(new THREE.Vector3(0, 0, 0), 520, -1.0);

    // Keep the resident region matched to what the camera can see. Polled
    // rather than driven from input because zoom, pan, fly and slot recalls all
    // move it, and one place that asks "what is visible now?" cannot miss one.
    const follow = window.setInterval(() => {
      const radius = loadRadiusFor(rig.distance);
      const cx = chunkIndexOf(rig.target.x);
      const cy = chunkIndexOf(rig.target.z);
      void store
        .loadRegion(cx - radius, cy - radius, cx + radius, cy + radius)
        .catch(() => undefined);
    }, 700);

    // Test probe. The A2 smoke drives real mouse strokes and then has to ask
    // "did the ground actually move?" — reading the store is the only honest
    // answer, and a screenshot cannot give it. Dev/CI builds only.
    if (import.meta.env.DEV) {
      (window as unknown as { __dawnedMapEditor?: unknown }).__dawnedMapEditor = {
        /**
         * Total ground displacement, not the peak: a hill raised in the middle
         * of an island never beats its summit, so a max-height comparison
         * reports "the brush did nothing" for a brush that worked fine.
         */
        heightSum: (): { sum: number; max: number; chunks: number } => {
          let sum = 0;
          let max = -Infinity;
          const chunks = store.all().filter((chunk) => chunk.enabled);
          for (const chunk of chunks) {
            for (const height of chunk.heights) {
              sum += height;
              if (height > max) max = height;
            }
          }
          return { sum, max, chunks: chunks.length };
        },
        heightAt: (x: number, z: number): number | null => store.heightAt(x, z),
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(follow);
      observer.disconnect();
      store.dispose();
      viewport.dispose();
      delete (window as unknown as { __dawnedMapEditor?: unknown }).__dawnedMapEditor;
      sessionRef.current = null;
    };
  }, []);

  // --- lock -----------------------------------------------------------------
  //
  // Polled on a 15 s interval, well inside the server's 45 s lease: a lapsed
  // lock mid-session would start refusing saves with no warning. While it is
  // OURS the poll RENEWS (POST) instead of reading, which is what keeps the
  // lease alive for as long as the tab is open.

  const lockQuery = useQuery({
    queryKey: ['map-lock'],
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<LockState> =>
      lockRef.current?.mine ? apiPost<LockState>('/map/lock') : apiGet<LockState>('/map/lock'),
  });
  const lock = lockQuery.data ?? null;
  // The poll above READS this to decide read-vs-renew, so it has to be current
  // before the next interval fires — hence its own effect next to the query.
  useEffect(() => {
    lockRef.current = lock;
  }, [lock]);

  const takeLock = async (force: boolean): Promise<void> => {
    try {
      const next = await apiPost<LockState>('/map/lock', { force });
      queryClient.setQueryData(['map-lock'], next);
      say(next.mine ? 'You hold the editing lock.' : `${next.heldBy ?? 'Someone'} is editing.`);
    } catch (error) {
      say(error instanceof ApiRequestError ? error.message : 'Could not take the lock.');
    }
  };

  // --- placement ------------------------------------------------------------
  //
  // The refs a new object needs (a model, an enemy, a loot table) come from
  // what is actually published, so a stamped object is legal the instant it
  // exists rather than a row the bake will reject later.

  const placementRefs = useQuery({
    queryKey: ['map-placement-refs'],
    staleTime: 60_000,
    queryFn: async () => {
      const [models, enemies, loot] = await Promise.all([
        apiGet<{ models: string[] }>('/map/models').catch(() => ({ models: [] })),
        apiGet<{ enemies: { id: string }[] }>('/enemies').catch(() => ({ enemies: [] })),
        apiGet<{ tables: { id: string }[] }>('/loot-tables').catch(() => ({ tables: [] })),
      ]);
      return {
        modelRef: models.models[0] ?? '',
        enemyId: enemies.enemies[0]?.id ?? '',
        lootTableId: loot.tables[0]?.id ?? '',
      };
    },
  });

  const stampObject = async (point: THREE.Vector3): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    const layer = placeLayerRef.current;
    const taken = new Set(session.objects.all().map((object) => object.id));
    const built = newObjectDef(
      layer,
      mintId(layer, point.x, point.z, taken),
      point.x,
      point.z,
      placementRefs.data ?? { modelRef: '', enemyId: '', lootTableId: '' },
    );
    if ('error' in built) {
      say(built.error);
      return;
    }
    const saved = await session.objects.save(layer, built.def, `Place ${layer}`);
    if (saved) {
      setSelectedId(String(built.def.id));
      say(`Placed ${LAYER_LABEL[layer] ?? layer}.`);
    }
  };

  // --- pointer --------------------------------------------------------------

  const worldUnderPointer = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): THREE.Vector3 | null => {
    const session = sessionRef.current;
    const canvas = canvasRef.current;
    if (!session || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return session.viewport.pick(ndcX, ndcY);
  };

  const painting = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const clock = useRef(new StrokeClock());

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const session = sessionRef.current;
    if (!session) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    lastPointer.current = { x: event.clientX, y: event.clientY };

    // Middle or right drag is always camera, whatever the tool — the owner
    // must never have to put a tool down to look at what they are doing.
    if (event.button !== 0) return;

    const point = worldUnderPointer(event);
    if (!point) return;

    if (toolRef.current === 'measure') {
      setMeasure((current) =>
        current && !current.to.equals(current.from)
          ? { from: point.clone(), to: point.clone() }
          : { from: current?.from ?? point.clone(), to: point.clone() },
      );
      return;
    }

    if (!lockRef.current?.mine) {
      say('You are read-only — take the editing lock first.');
      return;
    }

    // A click on an existing marker always SELECTS it, whatever the tool —
    // otherwise placing next to a spawner means stacking one on top of it, and
    // there would be no way to pick the buried one again.
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const hitId = session.viewport.pickObject(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (hitId) {
        setSelectedId(hitId);
        return;
      }
    }

    if (toolRef.current === 'place') {
      setSelectedId(null);
      void stampObject(point);
      return;
    }

    if (toolRef.current === 'zone') {
      session.sketch.add(point.x, point.z);
      setSketchLength(session.sketch.length);
      return;
    }

    if (toolRef.current === 'board') {
      const cx = chunkIndexOf(point.x);
      const cy = chunkIndexOf(point.z);
      const chunk = session.store.get(cx, cy);
      if (chunk) setChunkEnabled(session.store, session.journal, cx, cy, !chunk.enabled);
      return;
    }
    if (toolRef.current === 'water') {
      const cx = chunkIndexOf(point.x);
      const cy = chunkIndexOf(point.z);
      const chunk = session.store.get(cx, cy);
      if (!chunk) return;
      setWaterLevel(
        session.store,
        session.journal,
        cx,
        cy,
        chunk.waterLevel === null ? Number(point.y.toFixed(2)) : null,
      );
      return;
    }

    painting.current = true;
    clock.current.start();
    session.journal.begin(toolRef.current === 'sculpt' ? labelFor(brushRef.current) : 'Paint');
    dab(point, event.ctrlKey || event.metaKey);
  };

  const dab = (point: THREE.Vector3, invert: boolean): void => {
    const session = sessionRef.current;
    if (!session) return;
    const dt = clock.current.tick();
    if (toolRef.current === 'sculpt') {
      applyBrush(session.store, session.journal, brushRef.current, point.x, point.z, dt, invert);
    } else {
      applyPaint(session.store, session.journal, paintRef.current, point.x, point.z, dt);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const session = sessionRef.current;
    if (!session) return;
    const previous = lastPointer.current;
    lastPointer.current = { x: event.clientX, y: event.clientY };

    // Camera drags (buttons is a bitmask: 2 = right, 4 = middle).
    if (previous && (event.buttons & 2 || event.buttons & 4)) {
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      const height = canvasRef.current?.clientHeight ?? 800;
      if (event.shiftKey || event.buttons & 4) session.rig.pan(dx, dy, height);
      else session.rig.orbit(dx, dy);
      return;
    }

    const point = worldUnderPointer(event);
    if (point) {
      setCursor({ x: point.x, z: point.z, y: point.y });
      const radius =
        toolRef.current === 'paint' ? paintRef.current.radius : brushRef.current.radius;
      session.brushRing.visible = toolRef.current === 'sculpt' || toolRef.current === 'paint';
      session.brushRing.position.set(point.x, point.y + 0.4, point.z);
      session.brushRing.scale.set(radius, 1, radius);
    } else {
      session.brushRing.visible = false;
    }

    if (toolRef.current === 'zone') {
      session.sketch.refresh((x, z) => session.store.heightAt(x, z), point);
    }

    if (painting.current && point && (event.buttons & 1) !== 0) {
      dab(point, event.ctrlKey || event.metaKey);
    }
    if (toolRef.current === 'measure' && measure && point && (event.buttons & 1) !== 0) {
      setMeasure({ from: measure.from, to: point.clone() });
    }
  };

  const onPointerUp = (): void => {
    const session = sessionRef.current;
    if (!session) return;
    if (painting.current) {
      painting.current = false;
      session.journal.commit(session.store);
    }
    lastPointer.current = null;
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    sessionRef.current?.rig.zoom(event.deltaY);
  };

  // --- measurement gizmo ----------------------------------------------------

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (!measure || tool !== 'measure') {
      session.measureLine.visible = false;
      return;
    }
    session.measureLine.geometry.setFromPoints([
      measure.from.clone().setY(measure.from.y + 0.3),
      measure.to.clone().setY(measure.to.y + 0.3),
    ]);
    session.measureLine.visible = true;
  }, [measure, tool]);

  // --- object views ---------------------------------------------------------
  //
  // Rebuilt wholesale on change rather than diffed: the whole set is a few
  // hundred markers, rebuilding one is microseconds, and a diff would be a
  // second source of truth about what is on screen.

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.viewport.clearObjectViews();
    for (const object of objects) {
      if (hiddenLayers.has(object.layer)) continue;
      const view = buildObjectView(
        object,
        (x, z) => session.store.heightAt(x, z),
        object.id === selectedId,
      );
      session.viewport.setObjectView(object.id, view);
    }
  }, [objects, selectedId, hiddenLayers, saveState]);

  // --- zone ambience preview ------------------------------------------------
  //
  // MAP_EDITOR.md §2.4's "instant viewport preview". Fog values read as numbers
  // and land as atmosphere; the only way to know whether 420 m feels right is
  // to stand in it. Off by default because a zone's dusk hides the shape you
  // are sculpting.

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const zone = previewZone && selected?.layer === 'zone' ? selected.def.ambience : null;
    const parsed = zone ? zoneAmbienceSchema.safeParse(zone) : null;
    applyAmbiencePreview(
      { scene: session.viewport.scene, sun: session.viewport.sun, hemi: session.viewport.hemi },
      parsed?.success ? parsed.data : null,
      EDITOR_LIGHT,
    );
  }, [previewZone, selected]);

  // --- overlays -------------------------------------------------------------

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.viewport.setOverlay(overlay, (cx, cy) => session.store.get(cx, cy));
  }, [overlay]);

  useEffect(() => {
    sessionRef.current?.viewport.setChunkGridVisible(showGrid);
  }, [showGrid]);

  useEffect(() => {
    sessionRef.current?.rig.setMode(cameraMode);
  }, [cameraMode]);

  /** `[` / `]` (Shift: strength) — one place, so the keymap and any future
   * on-screen slider cannot drift apart on the clamps. */
  const adjustRadius = useCallback((delta: number, strength: boolean): void => {
    if (toolRef.current === 'paint') {
      setPaint((current) =>
        strength
          ? { ...current, strength: clamp(current.strength + delta * 0.05, 0.05, 1) }
          : { ...current, radius: clamp(current.radius + delta, 1, 120) },
      );
    } else {
      setBrush((current) =>
        strength
          ? { ...current, strength: clamp(current.strength + delta * 0.5, 0.25, 40) }
          : { ...current, radius: clamp(current.radius + delta, 1, 120) },
      );
    }
  }, []);

  /**
   * Close the outline into a real zone row.
   *
   * The polygon is normalised (winding, duplicate corners) before it is saved
   * — the game's `pointInPolygon` expects counter-clockwise, and making the
   * owner care about winding order while they trace a coastline would be
   * absurd.
   */
  const finishZone = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    const problems = zoneDrawProblems(session.sketch.points);
    if (problems.length > 0) {
      say(problems[0]!);
      return;
    }
    const polygon = normalisePolygon(session.sketch.points);
    let centreX = 0;
    let centreZ = 0;
    for (const [px, pz] of polygon) {
      centreX += px / polygon.length;
      centreZ += pz / polygon.length;
    }
    const taken = new Set(session.objects.all().map((object) => object.id));
    const id = mintId('zone', centreX, centreZ, taken);
    const saved = await session.objects.save(
      'zone',
      {
        id,
        name: 'New zone',
        levelMin: 1,
        levelMax: 10,
        polygon,
        ambience: DEFAULT_AMBIENCE,
        safe: false,
        settlement: null,
      },
      `Draw ${id}`,
    );
    if (saved) {
      session.sketch.clear();
      setSketchLength(0);
      setSelectedId(id);
      say(`Zone drawn with ${polygon.length} corners. Name it in the inspector.`);
    }
  }, [say]);

  const cancelZone = useCallback((): void => {
    const session = sessionRef.current;
    if (!session) return;
    session.sketch.clear();
    setSketchLength(0);
  }, []);

  // --- keymap (MAP_EDITOR.md §6) --------------------------------------------

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent): void => {
      const session = sessionRef.current;
      if (!session || isTyping(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) session.journal.redo(session.store);
        else session.journal.undo(session.store);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault();
        session.journal.redo(session.store);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        event.preventDefault();
        void session.store.flush();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Zone drawing owns Enter/Escape/Backspace while an outline is open.
      if (toolRef.current === 'zone' && session.sketch.length > 0) {
        if (event.code === 'Enter' || event.code === 'NumpadEnter') {
          event.preventDefault();
          void finishZone();
          return;
        }
        if (event.code === 'Escape') {
          cancelZone();
          return;
        }
        if (event.code === 'Backspace') {
          event.preventDefault();
          session.sketch.undoPoint();
          session.sketch.refresh((x, z) => session.store.heightAt(x, z), null);
          setSketchLength(session.sketch.length);
          return;
        }
      }

      switch (event.code) {
        case 'KeyB':
          setTool((current) => (current === 'sculpt' ? 'paint' : 'sculpt'));
          break;
        case 'BracketLeft':
          adjustRadius(-2, event.shiftKey);
          break;
        case 'BracketRight':
          adjustRadius(2, event.shiftKey);
          break;
        case 'KeyT':
          setCameraMode((mode) => (mode === 'top' ? 'orbit' : 'top'));
          break;
        case 'KeyO':
          setOverlay((current) => nextOverlay(current));
          break;
        case 'KeyG':
          setShowGrid((current) => !current);
          break;
        case 'KeyF': {
          if (cursor) session.rig.frame(new THREE.Vector3(cursor.x, cursor.y ?? 0, cursor.z));
          break;
        }
        default:
          break;
      }

      // 1–9 camera slots: plain press recalls, Shift stores (MAP_EDITOR.md §6).
      const slotMatch = /^Digit([1-9])$/.exec(event.code);
      if (slotMatch) {
        const slot = Number(slotMatch[1]);
        if (event.shiftKey) {
          session.slots.set(slot, session.rig.save());
          say(`Camera slot ${slot} stored.`);
        } else {
          const state = session.slots.get(slot);
          if (state) {
            session.rig.restore(state);
            setCameraMode(state.mode);
          }
        }
      }

      if (cameraMode === 'fly') session.rig.keyDown(event.code);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      sessionRef.current?.rig.keyUp(event.code);
    };
    const onBlur = (): void => {
      sessionRef.current?.rig.clearKeys();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // `cursor` and `cameraMode` are read inside; re-binding on their change is
    // cheap and keeps the handler honest rather than reading stale values.
  }, [cursor, cameraMode, say, adjustRadius, finishZone, cancelZone]);

  // --- generators + import --------------------------------------------------

  const runIsland = (): void => {
    const session = sessionRef.current;
    if (!session) return;
    const written = generateIsland(session.store, session.journal, island);
    say(`Island written into ${written} chunks. Ctrl+Z takes it back.`);
  };

  const runErosion = (): void => {
    const session = sessionRef.current;
    if (!session) return;
    const moved = erode(session.store, session.journal, session.store.all(), DEFAULT_EROSION);
    say(`Eroded ${moved.toLocaleString()} vertices.`);
  };

  const runAutoSplat = (): void => {
    const session = sessionRef.current;
    if (!session) return;
    const painted = autoSplat(
      session.store,
      session.journal,
      session.store.all(),
      defaultAutoSplatRules(0),
    );
    say(`Auto-splatted ${painted.toLocaleString()} texels.`);
  };

  const importLive = async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if (
      !window.confirm(
        'Replace the draft with the LIVE map?\n\nThis overwrites draft chunks and objects with what players are standing on right now. A checkpoint is taken first.',
      )
    ) {
      return;
    }
    setBusy('Importing the live world…');
    try {
      const report = await apiPost<{ chunks: number; zones: number; spawners: number }>(
        '/map/import-live',
      );
      session.store.reset();
      session.viewport.clearChunks();
      const radius = loadRadiusFor(session.rig.distance);
      const cx = chunkIndexOf(session.rig.target.x);
      const cy = chunkIndexOf(session.rig.target.z);
      await session.store.loadRegion(cx - radius, cy - radius, cx + radius, cy + radius);
      say(
        `Imported ${report.chunks} chunks, ${report.zones} zones and ${report.spawners} spawners.`,
      );
    } catch (error) {
      say(error instanceof ApiRequestError ? error.message : 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * "Clear layer…" — the start-fresh requirement (MAP_EDITOR.md §3). Double
   * confirmed, and the server takes a checkpoint before it runs, so even this
   * is recoverable after a reload.
   */
  const clearLayer = async (layer: string, count: number): Promise<void> => {
    if (
      !window.confirm(`Delete all ${count} ${LAYER_LABEL[layer] ?? layer} rows from the draft?`)
    ) {
      return;
    }
    if (!window.confirm('This cannot be undone with Ctrl+Z. A checkpoint is taken first. Sure?')) {
      return;
    }
    try {
      const result = await apiPost<{ removed: number; checkpointId: number }>(
        '/map/objects/clear-layer',
        { layer },
      );
      await sessionRef.current?.objects.load();
      setSelectedId(null);
      say(`Cleared ${result.removed} ${layer} rows (checkpoint #${result.checkpointId}).`);
    } catch (error) {
      say(error instanceof ApiRequestError ? error.message : 'Clear failed.');
    }
  };

  // --- render ---------------------------------------------------------------

  const readOnly = !lock?.mine;
  const canWrite = user.role === 'admin';

  return (
    <div className="map-editor">
      <header className="me-toolbar">
        <div className="me-modes">
          {(['sculpt', 'paint', 'water', 'board', 'place', 'zone', 'measure'] as ToolId[]).map(
            (id) => (
              <button
                key={id}
                type="button"
                className={`ws-btn${tool === id ? ' me-on' : ''}`}
                onClick={() => {
                  setTool(id);
                }}
              >
                {TOOL_LABELS[id]}
              </button>
            ),
          )}
        </div>

        <div className="me-options">
          {tool === 'sculpt' && (
            <>
              <select
                className="ws-input"
                value={brush.kind}
                onChange={(event) => {
                  setBrush({ ...brush, kind: event.target.value as BrushSettings['kind'] });
                }}
              >
                {Object.values(BrushKind).map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <NumberField
                label="radius"
                value={brush.radius}
                min={1}
                max={120}
                onChange={(radius) => {
                  setBrush({ ...brush, radius });
                }}
              />
              <NumberField
                label="strength"
                value={brush.strength}
                min={0.25}
                max={40}
                step={0.25}
                onChange={(strength) => {
                  setBrush({ ...brush, strength });
                }}
              />
              {(brush.kind === 'flatten' ||
                brush.kind === 'set_height' ||
                brush.kind === 'terrace') && (
                <NumberField
                  label={brush.kind === 'terrace' ? 'step' : 'target'}
                  value={brush.target}
                  min={-100}
                  max={400}
                  step={0.5}
                  onChange={(target) => {
                    setBrush({ ...brush, target });
                  }}
                />
              )}
              <FalloffPicker
                value={brush.falloff}
                onChange={(falloff) => {
                  setBrush({ ...brush, falloff });
                }}
              />
            </>
          )}

          {tool === 'paint' && (
            <>
              <div className="me-layers">
                {SPLAT_LAYERS.map((layer, index) => (
                  <button
                    key={layer.id}
                    type="button"
                    title={layer.name}
                    className={`me-swatch${paint.layer === index ? ' me-on' : ''}`}
                    style={{ background: layer.color }}
                    onClick={() => {
                      setPaint({ ...paint, layer: index });
                    }}
                  />
                ))}
              </div>
              <NumberField
                label="radius"
                value={paint.radius}
                min={1}
                max={120}
                onChange={(radius) => {
                  setPaint({ ...paint, radius });
                }}
              />
              <NumberField
                label="slope ≤"
                value={paint.slopeMax}
                min={0}
                max={90}
                onChange={(slopeMax) => {
                  setPaint({ ...paint, slopeMax });
                }}
              />
              <NumberField
                label="height ≥"
                value={paint.heightMin}
                min={-200}
                max={400}
                onChange={(heightMin) => {
                  setPaint({ ...paint, heightMin });
                }}
              />
            </>
          )}

          {tool === 'place' && (
            <>
              <select
                className="ws-input"
                value={placeLayer}
                onChange={(event) => {
                  setPlaceLayer(event.target.value as PlaceableLayer);
                }}
              >
                {PLACEABLE_LAYERS.map((layer) => (
                  <option key={layer} value={layer}>
                    {LAYER_LABEL[layer] ?? layer}
                  </option>
                ))}
              </select>
              <span className="me-hint">
                Click the ground to place. Click a marker to select it instead.
              </span>
            </>
          )}

          {tool === 'zone' && (
            <>
              <span className="me-hint">
                {sketchLength === 0
                  ? 'Click the ground to trace a zone border.'
                  : `${sketchLength} corners — Enter closes it, Backspace undoes one, Esc cancels.`}
              </span>
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                disabled={readOnly || sketchLength < 3}
                onClick={() => {
                  void finishZone();
                }}
              >
                Close zone
              </button>
              {sketchLength > 0 && (
                <button type="button" className="ws-btn" onClick={cancelZone}>
                  Cancel
                </button>
              )}
            </>
          )}

          {tool === 'water' && <span className="me-hint">Click a chunk to set / clear water.</span>}
          {tool === 'board' && (
            <span className="me-hint">Click a chunk to include it in the world, or remove it.</span>
          )}
          {tool === 'measure' && (
            <span className="me-hint">
              {measure
                ? `${measure.from.distanceTo(measure.to).toFixed(1)} m`
                : 'Drag to measure a distance.'}
            </span>
          )}
        </div>

        <div className="me-right">
          <button
            type="button"
            className="ws-btn"
            disabled={!undoDepth.canUndo}
            title={undoDepth.label}
            onClick={() => {
              const session = sessionRef.current;
              if (session) session.journal.undo(session.store);
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="ws-btn"
            disabled={!undoDepth.canRedo}
            onClick={() => {
              const session = sessionRef.current;
              if (session) session.journal.redo(session.store);
            }}
          >
            Redo
          </button>
          <button
            type="button"
            className="ws-btn"
            onClick={() => {
              setShowGenerators((v) => !v);
            }}
          >
            Generate…
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            disabled={!canWrite}
            onClick={() => {
              setShowPublish(true);
            }}
          >
            Validate ▸ Publish
          </button>
        </div>
      </header>

      <div className="me-body">
        <div className="me-viewport" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="me-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(event) => {
              event.preventDefault();
            }}
          />
          {busy && <div className="me-busy">{busy}</div>}
          {toast && <div className="me-toast">{toast}</div>}
        </div>

        <aside className="me-side">
          <section className="ws-panel me-card">
            <h3>Editing lock</h3>
            {lock?.mine ? (
              <p className="me-ok">You hold the lock.</p>
            ) : (
              <p className="me-warn">
                {lock?.heldBy ? `${lock.heldBy} is editing.` : 'Nobody holds the lock.'}
              </p>
            )}
            {lock?.takeoverRequestedBy && lock.mine && (
              <p className="me-warn">{lock.takeoverRequestedBy} has requested a takeover.</p>
            )}
            <div className="me-row">
              {!lock?.mine && canWrite && (
                <button
                  type="button"
                  className="ws-btn"
                  onClick={() => {
                    void takeLock(Boolean(lock?.heldBy));
                  }}
                >
                  {lock?.heldBy ? 'Force takeover' : 'Take lock'}
                </button>
              )}
              {lock?.mine && (
                <button
                  type="button"
                  className="ws-btn"
                  onClick={() => {
                    void apiDelete('/map/lock')
                      .catch(() => undefined)
                      .finally(() => {
                        void lockQuery.refetch();
                      });
                  }}
                >
                  Release
                </button>
              )}
            </div>
          </section>

          <section className="ws-panel me-card">
            <h3>View</h3>
            <div className="me-row">
              {(['orbit', 'fly', 'top'] as CameraMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`ws-btn${cameraMode === mode ? ' me-on' : ''}`}
                  onClick={() => {
                    setCameraMode(mode);
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
            <label className="me-check">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => {
                  setShowGrid(event.target.checked);
                }}
              />
              Chunk grid <span className="ws-kbd">G</span>
            </label>
            {selected?.layer === 'zone' && (
              <label className="me-check">
                <input
                  type="checkbox"
                  checked={previewZone}
                  onChange={(event) => {
                    setPreviewZone(event.target.checked);
                  }}
                />
                Preview this zone&apos;s ambience
              </label>
            )}
            <label className="me-field">
              <span>Overlay</span>
              <select
                className="ws-input"
                value={overlay}
                onChange={(event) => {
                  setOverlay(event.target.value as OverlayKind);
                }}
              >
                <option value="none">None (splat colours)</option>
                <option value="slope">Slope heat</option>
                <option value="walkable">Walkability preview</option>
                <option value="height">Height bands</option>
              </select>
            </label>
            <p className="me-hint">
              Fly: <span className="ws-kbd">WASD</span> + <span className="ws-kbd">Q/E</span>, Shift
              to sprint. Right-drag orbits, Shift+right-drag pans.{' '}
              <span className="ws-kbd">1–9</span> recall camera slots, Shift+digit stores.
            </p>
          </section>

          {showGenerators && (
            <section className="ws-panel me-card">
              <h3>Generators</h3>
              <p className="me-hint">
                Each runs as ONE undo step. Nothing reaches the game until you publish.
              </p>
              <NumberField
                label="seed"
                value={island.seed}
                min={0}
                max={999999}
                onChange={(seed) => {
                  setIsland({ ...island, seed });
                }}
              />
              <NumberField
                label="radius m"
                value={island.radius}
                min={40}
                max={900}
                onChange={(radius) => {
                  setIsland({ ...island, radius });
                }}
              />
              <NumberField
                label="peak m"
                value={island.peak}
                min={5}
                max={220}
                onChange={(peak) => {
                  setIsland({ ...island, peak });
                }}
              />
              <div className="me-row">
                <button
                  type="button"
                  className="ws-btn"
                  disabled={readOnly}
                  onClick={() => {
                    const session = sessionRef.current;
                    if (!session) return;
                    setIsland({
                      ...island,
                      centerX: session.rig.target.x,
                      centerZ: session.rig.target.z,
                    });
                    say('Island centred on the camera pivot.');
                  }}
                >
                  Centre here
                </button>
                <button type="button" className="ws-btn" disabled={readOnly} onClick={runIsland}>
                  Island
                </button>
                <button type="button" className="ws-btn" disabled={readOnly} onClick={runErosion}>
                  Erode
                </button>
                <button type="button" className="ws-btn" disabled={readOnly} onClick={runAutoSplat}>
                  Auto-splat
                </button>
              </div>
            </section>
          )}

          <section className="ws-panel me-card">
            <h3>Layers</h3>
            {LAYER_ORDER.map((layer) => {
              const count = objects.filter((object) => object.layer === layer).length;
              const hidden = hiddenLayers.has(layer);
              return (
                <div key={layer} className="me-layer-row">
                  <button
                    type="button"
                    className={`me-eye${hidden ? ' is-off' : ''}`}
                    title={hidden ? 'Show' : 'Hide'}
                    onClick={() => {
                      setHiddenLayers((current) => {
                        const next = new Set(current);
                        if (next.has(layer)) next.delete(layer);
                        else next.add(layer);
                        return next;
                      });
                    }}
                  >
                    <span className="me-dot" style={{ background: swatchFor(layer) }} />
                  </button>
                  <span className={hidden ? 'me-layer-off' : ''}>
                    {LAYER_LABEL[layer] ?? layer}
                  </span>
                  <b>{count}</b>
                  <button
                    type="button"
                    className="ws-btn ws-btn--danger me-tiny"
                    disabled={readOnly || count === 0}
                    title={`Delete every ${layer} in the draft`}
                    onClick={() => {
                      void clearLayer(layer, count);
                    }}
                  >
                    Clear
                  </button>
                </div>
              );
            })}
          </section>

          {selected && (
            <ObjectInspector
              key={selected.id}
              object={selected}
              readOnly={readOnly}
              onApply={(def) => {
                const session = sessionRef.current;
                if (!session) return;
                void session.objects.save(selected.layer, def, `Edit ${selected.id}`);
              }}
              onDelete={() => {
                const session = sessionRef.current;
                if (!session) return;
                void session.objects.remove([selected.id], `Delete ${selected.id}`).then((ok) => {
                  if (ok) setSelectedId(null);
                });
              }}
              onFrame={() => {
                const session = sessionRef.current;
                if (!session || selected.x === null || selected.z === null) return;
                session.rig.frame(
                  new THREE.Vector3(
                    selected.x,
                    session.store.heightAt(selected.x, selected.z) ?? 0,
                    selected.z,
                  ),
                  40,
                );
              }}
            />
          )}

          <section className="ws-panel me-card">
            <h3>Draft</h3>
            <div className="me-row">
              <button
                type="button"
                className="ws-btn"
                disabled={readOnly}
                onClick={() => {
                  void importLive();
                }}
              >
                Import live map
              </button>
              <button
                type="button"
                className="ws-btn"
                onClick={() => {
                  void sessionRef.current?.store.flush();
                }}
              >
                Save now <span className="ws-kbd">Ctrl S</span>
              </button>
            </div>
            <p className="me-hint">
              Autosaves two seconds after you stop. Everything saved survives a closed tab.
            </p>
          </section>
        </aside>
      </div>

      <footer className="me-status">
        <span className={`me-save is-${saveState}`}>
          {saveState === 'clean' && 'Saved'}
          {saveState === 'dirty' && 'Unsaved changes'}
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'error' && `Save failed — ${saveDetail}`}
        </span>
        <span>
          {cursor
            ? `x ${cursor.x.toFixed(1)}  z ${cursor.z.toFixed(1)}  ${
                cursor.y === null ? 'no ground' : `y ${cursor.y.toFixed(2)}`
              }`
            : 'move over the world'}
        </span>
        <span>
          chunk{' '}
          {cursor
            ? `${clamp(chunkIndexOf(cursor.x), 0, WORLD_CHUNKS - 1)},${clamp(
                chunkIndexOf(cursor.z),
                0,
                WORLD_CHUNKS - 1,
              )}`
            : '—'}
        </span>
        <span>{readOnly ? 'read-only' : 'editing'}</span>
        {lastAction && (
          <span className="me-last" title={lastAction}>
            {lastAction}
          </span>
        )}
      </footer>

      {showPublish && (
        <PublishPanel
          onClose={() => {
            setShowPublish(false);
          }}
          onPublished={(version) => {
            say(`Published ${version} — the game is loading it now.`);
          }}
        />
      )}
    </div>
  );
};

// --- small pieces -----------------------------------------------------------

const TOOL_LABELS: Record<ToolId, string> = {
  sculpt: 'Sculpt',
  paint: 'Paint',
  water: 'Water',
  board: 'Board',
  place: 'Place',
  zone: 'Zone',
  measure: 'Measure',
};

/** Layer rows in the panel, in the order they are worth thinking about. */
const LAYER_ORDER = ['prop', 'scatter', 'spawner', 'node', 'npc', 'zone', 'poi', 'interactable'];

const swatchFor = (layer: string): string =>
  `#${(LAYER_COLOR[layer] ?? 0x999999).toString(16).padStart(6, '0')}`;

const OVERLAY_CYCLE: OverlayKind[] = ['none', 'slope', 'walkable', 'height'];
const nextOverlay = (current: OverlayKind): OverlayKind =>
  OVERLAY_CYCLE[(OVERLAY_CYCLE.indexOf(current) + 1) % OVERLAY_CYCLE.length] ?? 'none';

const labelFor = (brush: BrushSettings): string =>
  `${brush.kind.replace('_', ' ')} r${brush.radius}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const NumberField = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}): React.JSX.Element => (
  <label className="me-num">
    <span>{label}</span>
    <input
      className="ws-input"
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(clamp(next, min, max));
      }}
    />
  </label>
);

const FalloffPicker = ({
  value,
  onChange,
}: {
  value: BrushFalloff;
  onChange: (value: BrushFalloff) => void;
}): React.JSX.Element => (
  <select
    className="ws-input"
    value={value}
    onChange={(event) => {
      onChange(event.target.value as BrushFalloff);
    }}
  >
    {BRUSH_FALLOFFS.map((falloff) => (
      <option key={falloff} value={falloff}>
        {falloff}
      </option>
    ))}
  </select>
);

export const MAP_EDITOR_WORLD_MIN = WORLD_ORIGIN_M;
export const MAP_EDITOR_CHUNK_SIZE = CHUNK_SIZE_M;
