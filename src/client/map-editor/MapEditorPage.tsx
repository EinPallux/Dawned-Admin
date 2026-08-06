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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ApiRequestError, apiDelete, apiGet, apiPost, apiPut } from '../api.js';
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
import { ModelCache } from './model-cache.js';

import {
  DEFAULT_AMBIENCE,
  ZoneSketch,
  applyAmbiencePreview,
  normalisePolygon,
  zoneDrawProblems,
} from './zones.js';
import { EDITOR_LIGHT } from './viewport.js';
import {
  aggroOverlaps,
  campLinks,
  populationByZone,
  simulatePopulate,
  type EnemyFacts,
  type ZoneFacts,
} from './spawn-analysis.js';
import { buildSpawnOverlay, disposeSpawnOverlay } from './spawn-overlay.js';
import { spawnerDefSchema, zoneAmbienceSchema } from '@dawned/shared';
import { ObjectInspector } from './ObjectInspector.js';
import {
  INTERACTABLE_KINDS,
  LAYER_LABEL,
  PLACEABLE_LAYERS,
  newObjectDef,
  type InteractableKind,
  type PlaceableLayer,
} from './new-object.js';
import {
  ZoneHandles,
  deleteVertex,
  finaliseRing,
  insertVertex,
  moveVertex,
  polygonOf,
} from './zone-edit.js';
import { graphHops, shrinesFrom, travelProblems } from './travel-graph.js';
import { buildTravelOverlay, disposeTravelOverlay } from './travel-overlay.js';
import {
  DEFAULT_SCATTER_BRUSH,
  chunksUnderBrush,
  dabScatter,
  densityOf,
  densitySum,
  hasDensity,
  scatterRowId,
  strokeBase,
  type ScatterBrushSettings,
} from './scatter.js';
import {
  clickSelection,
  isMarquee,
  makePrefab,
  prefabDataSchema,
  rectFromDrag,
  stampPrefab,
  type Collection,
} from './collections.js';
import { ScatterCard } from './ScatterCard.js';
import { CollectionsCard } from './CollectionsCard.js';
import { KeymapCard } from './KeymapCard.js';
import { actionFor, loadKeymap, saveKeymap, type EditorAction, type Keymap } from './keymap.js';
import type { ScatterSet } from '@dawned/shared';

type ToolId = 'sculpt' | 'paint' | 'water' | 'board' | 'place' | 'scatter' | 'zone' | 'measure';

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
  handles: ZoneHandles;
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
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isolated, setIsolated] = useState(false);
  const [armedPrefabId, setArmedPrefabId] = useState<string | null>(null);
  const [scatterBrush, setScatterBrush] = useState<ScatterBrushSettings>(DEFAULT_SCATTER_BRUSH);
  const [keymap, setKeymap] = useState<Keymap>(() => loadKeymap());
  /** The marquee as the owner drags it — screen pixels, drawn as an overlay. */
  const [marqueeRect, setMarqueeRect] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [objects, setObjects] = useState<PlacedObject[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(() => new Set());
  const [sketchLength, setSketchLength] = useState(0);
  const [previewZone, setPreviewZone] = useState(false);
  const [spawnOverlay, setSpawnOverlay] = useState({ aggro: false, leash: false, camps: false });
  const [simulateSeed, setSimulateSeed] = useState<number | null>(null);
  const [interactKind, setInteractKind] = useState<InteractableKind>('chest');
  /** Which resource-node definition the Place tool stamps (P10-D). */
  const [nodeKind, setNodeKind] = useState('');
  const [showTravel, setShowTravel] = useState(false);
  /** Bumped when a zone polygon changes, to rebuild the handles from the row. */
  const [handleEpoch, setHandleEpoch] = useState(0);

  // Tool settings are read inside imperative pointer handlers that are
  // registered once; refs keep them current without re-registering listeners.
  // Synced in an effect rather than during render — a ref write in the render
  // body is a side effect, and React is allowed to render twice.
  const toolRef = useRef(tool);
  const brushRef = useRef(brush);
  const paintRef = useRef(paint);
  const placeLayerRef = useRef(placeLayer);
  const interactKindRef = useRef(interactKind);
  const nodeKindRef = useRef(nodeKind);
  const scatterBrushRef = useRef(scatterBrush);
  const keymapRef = useRef(keymap);
  const selectedRef = useRef<ReadonlySet<string>>(selectedIds);
  /** Rows touched by the scatter stroke in progress, saved on mouse-up. */
  const scatterStroke = useRef(
    new Map<string, { cx: number; cy: number; setId: string; density: number[] }>(),
  );
  const lockRef = useRef<LockState | null>(null);
  useEffect(() => {
    toolRef.current = tool;
    brushRef.current = brush;
    paintRef.current = paint;
    placeLayerRef.current = placeLayer;
    interactKindRef.current = interactKind;
    scatterBrushRef.current = scatterBrush;
    armedPrefabRef.current = armedPrefabId;
    keymapRef.current = keymap;
    selectedRef.current = selectedIds;
  }, [
    tool,
    brush,
    paint,
    placeLayer,
    interactKind,
    scatterBrush,
    armedPrefabId,
    keymap,
    selectedIds,
  ]);

  /**
   * Say something. The toast fades, the status-bar line does NOT: "imported 271
   * chunks" is a result the owner may want to read after looking away, and a
   * message that only exists for three seconds is a message that gets missed.
   */
  /** The object the inspector and the ambience preview are looking at. */
  /**
   * The inspector edits ONE thing. With several selected there is no single row
   * to show, and a "multi-edit" that silently writes the same value into a
   * spawner and a signpost is worse than no inspector at all.
   */
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0]! : null;
  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const setSelectedId = useCallback((id: string | null): void => {
    setSelectedIds(id === null ? new Set() : new Set([id]));
  }, []);

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

    const handles = new ZoneHandles();
    viewport.addGizmo(handles.group);

    const session: EditorSession = {
      viewport,
      rig,
      store,
      objects: objectStore,
      journal,
      brushRing,
      measureLine,
      sketch,
      handles,
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
        /**
         * The placed rows as the store holds them. A2/A3 assertions about
         * objects — a zone that grew a corner, a shrine that joined the travel
         * graph — are about DATA, and reading the panel's own list back is the
         * only way to check the thing that will be published.
         */
        objects: (): { id: string; layer: string; def: Record<string, unknown> }[] =>
          objectStore.all().map(({ id, layer, def }) => ({ id, layer, def })),
        /** Where the camera is looking — the pivot the generators centre on. */
        pivot: (): { x: number; z: number } => ({ x: rig.target.x, z: rig.target.z }),
        /**
         * Where a world point lands on screen, in page pixels.
         *
         * The §7 scenario builds an islet at coordinates it discovered rather
         * than at a spot someone guessed, so it needs to know where that is to
         * click on it. Same projection the viewport renders with, so the answer
         * is the pixel the owner would aim at.
         */
        project: (x: number, z: number): { x: number; y: number } => {
          const rect = canvas.getBoundingClientRect();
          const ground = store.heightAt(x, z) ?? 0;
          const projected = new THREE.Vector3(x, ground, z).project(viewport.camera);
          return {
            x: rect.left + ((projected.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - projected.y) / 2) * rect.height,
          };
        },
        /**
         * Where a placed object's marker is ON SCREEN.
         *
         * A marker stands UP from the ground, so the pixel you clicked to
         * place it is not the pixel its body occupies — clicking the original
         * spot again can miss by twenty pixels. A test that hard-codes the
         * placement coordinates is testing its own arithmetic.
         */
        screenOf: (id: string): { x: number; y: number } | null => {
          const view = viewport.viewOf(id);
          if (!view) return null;
          const rect = canvas.getBoundingClientRect();
          const centre = new THREE.Box3().setFromObject(view).getCenter(new THREE.Vector3());
          const projected = centre.project(viewport.camera);
          return {
            x: rect.left + ((projected.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - projected.y) / 2) * rect.height,
          };
        },
        /**
         * Where the zone corner handles are ON SCREEN.
         *
         * The smoke drives real mouse events at real handles rather than
         * calling the edit functions — those already have unit tests, and what
         * a browser run is FOR is proving the pointer path in between. Nothing
         * else can tell you a handle is unclickable.
         */
        handles: (): { kind: string; index: number; x: number; y: number }[] => {
          const rect = canvas.getBoundingClientRect();
          const out: { kind: string; index: number; x: number; y: number }[] = [];
          for (const child of handles.group.children) {
            const tag = (child.userData as { handle?: { kind: string; index: number } }).handle;
            if (!tag) continue;
            const projected = child.position.clone().project(viewport.camera);
            out.push({
              kind: tag.kind,
              index: tag.index,
              x: rect.left + ((projected.x + 1) / 2) * rect.width,
              y: rect.top + ((1 - projected.y) / 2) * rect.height,
            });
          }
          return out;
        },
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
      const [models, enemies, loot, nodes] = await Promise.all([
        apiGet<{ models: string[] }>('/map/models').catch(() => ({ models: [] })),
        apiGet<{ enemies: { id: string }[] }>('/enemies').catch(() => ({ enemies: [] })),
        apiGet<{ tables: { id: string }[] }>('/loot-tables').catch(() => ({ tables: [] })),
        apiGet<{ nodes: { id: string }[] }>('/resource-nodes').catch(() => ({ nodes: [] })),
      ]);
      return {
        modelRef: models.models[0] ?? '',
        models: models.models,
        enemyId: enemies.enemies[0]?.id ?? '',
        lootTableId: loot.tables[0]?.id ?? '',
        nodeIds: nodes.nodes.map((row) => row.id),
      };
    },
  });

  /**
   * Published resource-node definitions, for the Place tool's picker (P10-D).
   *
   * Separate from `placementRefs` because the picker needs names and tiers to
   * be readable — "Birch · T1 woodcutting" rather than `node_woodcutting_birch`
   * — and a placement only stores the id.
   */
  const nodeDefs = useQuery({
    queryKey: ['map-node-defs'],
    staleTime: 60_000,
    queryFn: () =>
      apiGet<{
        nodes: {
          id: string;
          name: string;
          tier: number;
          profession: string;
          def: { radius: number };
        }[];
      }>('/resource-nodes').catch(() => ({ nodes: [] })),
  });
  const nodeChoices = useMemo(() => nodeDefs.data?.nodes ?? [], [nodeDefs.data]);
  /**
   * Footprints for the viewport. A node placement is deliberately thin, so the
   * only place its true size exists is the definition — without this a node is
   * the one placed thing drawn with no ring.
   */
  /**
   * The real baked models. One cache for the page: a model loads once and every
   * placement that names it redraws, which is what turns the viewport from a
   * field of coloured boxes into the world the game will show.
   */
  const modelCache = useMemo(() => new ModelCache(), []);
  const [modelsVersion, setModelsVersion] = useState(0);
  useEffect(() => {
    let raf = 0;
    // Coalesce: a town is a dozen models arriving within a second of each other
    // and each one would otherwise rebuild every marker on screen.
    const off = modelCache.onLoaded(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setModelsVersion((v) => v + 1);
      });
    });
    void modelCache.init();
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [modelCache]);

  const nodeRadii = useMemo(
    () => new Map(nodeChoices.map((node) => [node.id, node.def.radius])),
    [nodeChoices],
  );
  /**
   * Which definition the Place tool stamps. DERIVED rather than defaulted in an
   * effect: the first published node is a fallback, not a decision, and writing
   * it into state on arrival is a cascading render for something the render can
   * simply compute.
   */
  const activeNodeKind = nodeKind || (nodeChoices[0]?.id ?? '');
  // Its own sync rather than a line in the big ref effect above: the derived
  // value depends on a query declared further down the component, so it does
  // not exist yet up there.
  useEffect(() => {
    nodeKindRef.current = activeNodeKind;
  }, [activeNodeKind]);

  // --- scatter sets + editor collections (A3-d) -----------------------------

  const scatterSets = useQuery({
    queryKey: ['map-scatter-sets'],
    queryFn: () => apiGet<{ sets: ScatterSet[] }>('/map/scatter-sets'),
  });

  const collections = useQuery({
    queryKey: ['map-collections'],
    queryFn: () => apiGet<{ collections: Collection[] }>('/map/collections'),
  });

  const writeScatterSets = async (sets: ScatterSet[]): Promise<void> => {
    try {
      await apiPut('/map/scatter-sets', { sets });
      queryClient.setQueryData(['map-scatter-sets'], { sets });
    } catch (error) {
      say(error instanceof ApiRequestError ? error.message : 'Could not save the scatter set.');
    }
  };

  const saveCollection = async (
    id: string,
    kind: 'selection' | 'prefab',
    name: string,
    data: unknown,
  ): Promise<void> => {
    try {
      await apiPut('/map/collections', { id, kind, name, data });
      await collections.refetch();
      say(`Saved "${name}".`);
    } catch (error) {
      say(error instanceof ApiRequestError ? error.message : 'Could not save that.');
    }
  };

  /**
   * Paint one dab of scatter density.
   *
   * A dab can straddle a chunk seam, and the row for each chunk is created on
   * first touch — an empty grid is never stored, so a stroke that clips a
   * corner does not litter the draft with blank patches.
   */
  const scatterDab = (point: THREE.Vector3, erase: boolean): void => {
    const session = sessionRef.current;
    const brush = scatterBrushRef.current;
    if (!session || !brush.setId) return;
    for (const { cx, cy } of chunksUnderBrush(point.x, point.z, brush.radius)) {
      if (cx < 0 || cy < 0 || cx >= WORLD_CHUNKS || cy >= WORLD_CHUNKS) continue;
      const id = scatterRowId(cx, cy, brush.setId);
      // Dabs accumulate WITHIN the stroke. The store is only written on
      // mouse-up, so re-reading it per dab meant every dab started from the
      // pre-stroke grid and only the last one survived — painting looked
      // roughly right and erasing barely worked, which is how it was found.
      const staged = scatterStroke.current.get(id);
      const existing = session.objects.get(id);
      const before = strokeBase(staged?.density, existing ? densityOf(existing.def) : undefined);
      const after = dabScatter(
        before,
        cx,
        cy,
        point.x,
        point.z,
        brush.radius,
        brush.strength,
        erase,
      );
      if (densitySum(after) === densitySum(before)) continue;
      scatterStroke.current.set(id, { cx, cy, setId: brush.setId, density: after });
    }
    // Draw the stroke as it happens: the density grid IS the preview, and a
    // brush whose result only appears on mouse-up cannot be aimed.
    for (const [id, row] of scatterStroke.current) {
      const view = buildObjectView(
        { id, layer: 'scatter', def: { id, ...row }, x: null, z: null },
        (x, z) => session.store.heightAt(x, z),
        false,
      );
      session.viewport.setObjectView(id, view);
    }
  };

  /** Commit a scatter stroke: one save for the whole thing, one undo step. */
  const commitScatter = async (): Promise<void> => {
    const session = sessionRef.current;
    const stroke = scatterStroke.current;
    scatterStroke.current = new Map();
    if (!session || stroke.size === 0) return;
    const rows: { layer: string; def: Record<string, unknown> }[] = [];
    const empties: string[] = [];
    for (const [id, row] of stroke) {
      if (hasDensity(row.density)) rows.push({ layer: 'scatter', def: { id, ...row } });
      else if (session.objects.get(id)) empties.push(id);
    }
    if (rows.length > 0) await session.objects.saveMany(rows, 'Scatter');
    // Erasing a patch back to nothing DELETES the row rather than saving 256
    // zeroes — an empty patch is a ref the bake has to check for no reason.
    if (empties.length > 0) await session.objects.remove(empties, 'Clear scatter');
  };

  const stampObject = async (point: THREE.Vector3): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    const layer = placeLayerRef.current;
    const taken = new Set(session.objects.all().map((object) => object.id));
    const kind = interactKindRef.current;
    const built = newObjectDef(
      layer,
      mintId(layer, point.x, point.z, taken),
      point.x,
      point.z,
      placementRefs.data ?? {
        modelRef: '',
        models: [],
        enemyId: '',
        lootTableId: '',
        nodeIds: [],
      },
      kind,
      nodeKindRef.current,
    );
    if ('error' in built) {
      say(built.error);
      return;
    }
    const saved = await session.objects.save(layer, built.def, `Place ${layer}`);
    if (saved) {
      setSelectedId(String(built.def.id));
      say(
        layer === 'interactable'
          ? `Placed ${kind.replace('_', ' ')}.`
          : layer === 'node'
            ? `Placed ${nodeKindRef.current || 'resource node'}.`
            : `Placed ${LAYER_LABEL[layer] ?? layer}.`,
      );
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
    const ground = session.viewport.pick(ndcX, ndcY);
    // The zone tool falls back to the world plane. Zone borders run out over
    // open water and past the streamed region — requiring terrain under the
    // cursor would make half of every zone's outline untouchable, which is
    // exactly what it did before this fallback existed.
    if (ground || toolRef.current !== 'zone') return ground;
    return session.viewport.pickPlane(ndcX, ndcY);
  };

  const painting = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const clock = useRef(new StrokeClock());
  const marquee = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const armedPrefabRef = useRef<string | null>(null);

  /** Stamp the armed prefab where the ground was clicked. */
  const stampArmedPrefab = async (point: THREE.Vector3): Promise<void> => {
    const session = sessionRef.current;
    const entry = collections.data?.collections.find(
      (candidate) => candidate.id === armedPrefabRef.current,
    );
    if (!session || !entry) return;
    const parsed = prefabDataSchema.safeParse(entry.data);
    if (!parsed.success) {
      say(`"${entry.name}" is not a readable prefab.`);
      return;
    }
    const taken = new Set(session.objects.all().map((object) => object.id));
    const rows = stampPrefab(parsed.data, point.x, point.z, taken, mintId);
    const saved = await session.objects.saveMany(rows, `Stamp ${entry.name}`);
    if (saved) {
      setSelectedIds(new Set(rows.map((row) => String(row.def.id))));
      say(`Stamped ${entry.name} — ${rows.length} rows.`);
    }
  };

  // --- zone vertex editing (A3-c) -------------------------------------------
  //
  // A corner drag is previewed locally and saved ONCE on release. Saving per
  // pointer-move would be a row write every few milliseconds and would make
  // each pixel of the drag its own undo step.

  const vertexDrag = useRef<{
    zoneId: string;
    index: number;
    polygon: [number, number][];
    moved: boolean;
    refused: string | null;
  } | null>(null);

  /** Draw a polygon the store does not have yet (mid-drag). */
  const previewZonePolygon = (zoneId: string, polygon: [number, number][]): void => {
    const session = sessionRef.current;
    const zone = session?.objects.get(zoneId);
    if (!session || !zone) return;
    const groundAt = (x: number, z: number): number | null => session.store.heightAt(x, z);
    session.viewport.setObjectView(
      zoneId,
      buildObjectView({ ...zone, def: { ...zone.def, polygon } }, groundAt, true),
    );
    session.handles.build(polygon, groundAt);
  };

  /**
   * Commit an edit to a zone's outline, or explain why it was refused.
   *
   * The refusal path re-draws from the STORED row: after a rejected edit the
   * viewport must show what is saved, never the shape the owner was reaching
   * for — an editor that keeps drawing a polygon the server does not have is
   * how you publish something you never saw.
   */
  const applyZoneEdit = async (
    zone: PlacedObject,
    result: { polygon: [number, number][] } | { error: string },
    label: string,
  ): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if ('error' in result) {
      say(result.error);
      setHandleEpoch((epoch) => epoch + 1);
      return;
    }
    const polygon = finaliseRing(result.polygon);
    const saved = await session.objects.save('zone', { ...zone.def, polygon }, label);
    setHandleEpoch((epoch) => epoch + 1);
    if (saved) say(`${label} — ${polygon.length} corners.`);
  };

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

    // Shift+drag anywhere is a marquee. Recorded first, resolved on mouse-up:
    // a marquee that only knows it is one after ten pixels would otherwise eat
    // the click that started it.
    if (event.shiftKey && toolRef.current !== 'zone') {
      marquee.current = {
        x0: event.clientX,
        y0: event.clientY,
        x1: event.clientX,
        y1: event.clientY,
      };
      return;
    }

    // An armed prefab consumes the next ground click.
    if (armedPrefabRef.current) {
      void stampArmedPrefab(point);
      return;
    }

    if (toolRef.current === 'scatter') {
      if (!scatterBrushRef.current.setId) {
        say('Pick a scatter set first.');
        return;
      }
      painting.current = true;
      scatterDab(point, event.ctrlKey || event.metaKey);
      return;
    }

    // Zone corner handles come first of all: they sit ON the polygon they
    // edit, so an object pick would win every time and the corners would be
    // undraggable.
    const canvasEl = canvasRef.current;
    if (toolRef.current === 'zone' && selected?.layer === 'zone' && canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const hit = session.viewport.pickHandle(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const polygon = polygonOf(selected.def);
      if (hit && polygon) {
        if (hit.kind === 'edge') {
          void applyZoneEdit(
            selected,
            insertVertex(polygon, hit.index, point.x, point.z),
            'Added a corner',
          );
        } else if (event.shiftKey) {
          void applyZoneEdit(selected, deleteVertex(polygon, hit.index), 'Removed a corner');
        } else {
          vertexDrag.current = {
            zoneId: selected.id,
            index: hit.index,
            polygon,
            moved: false,
            refused: null,
          };
        }
        return;
      }
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
        setSelectedIds((current) => clickSelection(current, hitId, event.shiftKey));
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
      // The height comes from the STORE, not the ray: with the zone tool the
      // ray may have hit the world plane rather than ground, and reporting
      // "0.0 m" for terrain that has not streamed would be a lie.
      setCursor({ x: point.x, z: point.z, y: session.store.heightAt(point.x, point.z) });
      const radius =
        toolRef.current === 'paint' ? paintRef.current.radius : brushRef.current.radius;
      session.brushRing.visible = toolRef.current === 'sculpt' || toolRef.current === 'paint';
      session.brushRing.position.set(point.x, point.y + 0.4, point.z);
      session.brushRing.scale.set(radius, 1, radius);
    } else {
      session.brushRing.visible = false;
    }

    if (marquee.current && (event.buttons & 1) !== 0) {
      marquee.current = { ...marquee.current, x1: event.clientX, y1: event.clientY };
      setMarqueeRect({ ...marquee.current });
      return;
    }

    if (toolRef.current === 'scatter' && painting.current && point && (event.buttons & 1) !== 0) {
      scatterDab(point, event.ctrlKey || event.metaKey);
      return;
    }

    // A corner being dragged: keep the last LEGAL position, so pulling a corner
    // through the far edge stops at the fold instead of saving a bow tie.
    const drag = vertexDrag.current;
    if (drag && point && (event.buttons & 1) !== 0) {
      const moved = moveVertex(drag.polygon, drag.index, point.x, point.z);
      if ('error' in moved) drag.refused = moved.error;
      else {
        drag.polygon = moved.polygon;
        drag.moved = true;
        previewZonePolygon(drag.zoneId, moved.polygon);
      }
      return;
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

    const box = marquee.current;
    marquee.current = null;
    setMarqueeRect(null);
    if (box) {
      const rect = rectFromDrag(box.x0, box.y0, box.x1, box.y1);
      if (isMarquee(rect)) {
        const canvas = canvasRef.current;
        const bounds = canvas?.getBoundingClientRect();
        if (bounds) {
          const hits = session.viewport.objectsInRect(
            rect,
            bounds,
            (id) => !hiddenLayers.has(session.objects.get(id)?.layer ?? ''),
          );
          setSelectedIds((current) => new Set([...current, ...hits]));
          say(`${hits.length} selected.`);
        }
      }
      return;
    }

    if (painting.current && toolRef.current === 'scatter') {
      painting.current = false;
      void commitScatter();
      return;
    }
    if (painting.current) {
      painting.current = false;
      session.journal.commit(session.store);
    }
    const drag = vertexDrag.current;
    vertexDrag.current = null;
    if (drag?.moved) {
      const zone = session.objects.get(drag.zoneId);
      if (zone) void applyZoneEdit(zone, { polygon: drag.polygon }, 'Moved a corner');
      if (drag.refused) say(drag.refused);
    } else if (drag?.refused) {
      say(drag.refused);
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
        selectedIds.has(object.id),
        { nodeRadii, modelFor: (ref) => modelCache.instance(ref) },
      );
      session.viewport.setObjectView(object.id, view);
    }
  }, [objects, selectedIds, hiddenLayers, saveState, nodeRadii, modelCache, modelsVersion]);

  // --- spawns mode (A3-b) ---------------------------------------------------
  //
  // Everything here reads data the GAME already acts on: `campTag` is what the
  // server groups social aggro by, `aggroRadius`/`leashRadius` are what the AI
  // pulls and leashes with. Nothing invents a field the game would ignore.

  const enemyFacts = useQuery({
    queryKey: ['map-enemy-facts'],
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, EnemyFacts>> => {
      const data = await apiGet<{ enemies: Record<string, unknown>[] }>('/enemies');
      const out = new Map<string, EnemyFacts>();
      for (const row of data.enemies) {
        const id = typeof row.id === 'string' ? row.id : '';
        if (!id) continue;
        out.set(id, {
          id,
          name: typeof row.name === 'string' ? row.name : id,
          rank: typeof row.rank === 'string' ? row.rank : 'normal',
          aggroRadius: typeof row.aggroRadius === 'number' ? row.aggroRadius : 10,
          leashRadius: typeof row.leashRadius === 'number' ? row.leashRadius : 40,
        });
      }
      return out;
    },
  });

  /** Spawner rows that actually parse — a half-edited one is skipped rather
   * than crashing the panel that is supposed to help you fix it. */
  const spawners = useMemo(() => {
    const out = [];
    for (const object of objects) {
      if (object.layer !== 'spawner') continue;
      const parsed = spawnerDefSchema.safeParse(object.def);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }, [objects]);

  const zoneFacts = useMemo<ZoneFacts[]>(
    () =>
      objects
        .filter((object) => object.layer === 'zone' && Array.isArray(object.def.polygon))
        .map((object) => ({
          id: object.id,
          name: typeof object.def.name === 'string' ? object.def.name : object.id,
          polygon: object.def.polygon as [number, number][],
        })),
    [objects],
  );

  const links = useMemo(() => campLinks(spawners), [spawners]);
  const population = useMemo(
    () => populationByZone(spawners, zoneFacts, enemyFacts.data ?? new Map()),
    [spawners, zoneFacts, enemyFacts.data],
  );
  const overlaps = useMemo(
    () => aggroOverlaps(spawners, enemyFacts.data ?? new Map()),
    [spawners, enemyFacts.data],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const facts = enemyFacts.data ?? new Map<string, EnemyFacts>();
    const ghosts =
      simulateSeed !== null && selected?.layer === 'spawner'
        ? (() => {
            const parsed = spawnerDefSchema.safeParse(selected.def);
            return parsed.success ? simulatePopulate(parsed.data, simulateSeed, facts) : [];
          })()
        : [];
    const overlay =
      spawnOverlay.aggro || spawnOverlay.leash || spawnOverlay.camps || ghosts.length > 0
        ? buildSpawnOverlay({
            spawners,
            enemiesById: facts,
            links,
            ghosts,
            groundAt: (x, z) => session.store.heightAt(x, z),
            show: spawnOverlay,
          })
        : null;
    if (overlay) session.viewport.addGizmo(overlay);
    return () => {
      if (!overlay) return;
      session.viewport.removeGizmo(overlay);
      disposeSpawnOverlay(overlay);
    };
  }, [spawners, links, spawnOverlay, simulateSeed, selected, enemyFacts.data, saveState]);

  // --- isolation (A3-d) -----------------------------------------------------
  //
  // Isolation dims by HIDING rather than fading: a translucent hundred markers
  // is still a hundred markers in the way, and the point of isolating is to see
  // the ground you are working on.

  useEffect(() => {
    sessionRef.current?.viewport.setIsolation(isolated ? selectedIds : null);
  }, [isolated, selectedIds, objects]);

  useEffect(() => {
    saveKeymap(keymap);
  }, [keymap]);

  // --- zone corner handles (A3-c) -------------------------------------------
  //
  // Shown only with the zone tool in hand and a zone selected: handles over
  // every polygon at once would bury the terrain you are sculpting, and a
  // corner you can grab by accident while painting is a shape you break
  // without noticing.

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const polygon = tool === 'zone' && selected?.layer === 'zone' ? polygonOf(selected.def) : null;
    if (polygon) session.handles.build(polygon, (x, z) => session.store.heightAt(x, z));
    else session.handles.clear();
  }, [tool, selected, handleEpoch, saveState]);

  // --- shrines & the travel graph (A3-c) ------------------------------------

  const shrines = useMemo(() => shrinesFrom(objects), [objects]);
  const hops = useMemo(() => graphHops(shrines), [shrines]);
  const travelIssues = useMemo(() => travelProblems(shrines), [shrines]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !showTravel) return;
    const overlay = buildTravelOverlay({
      shrines,
      hops,
      groundAt: (x, z) => session.store.heightAt(x, z),
    });
    if (overlay) session.viewport.addGizmo(overlay);
    return () => {
      if (!overlay) return;
      session.viewport.removeGizmo(overlay);
      disposeTravelOverlay(overlay);
    };
  }, [showTravel, shrines, hops, saveState]);

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
  }, [say, setSelectedId]);

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

      // Escape puts down an armed prefab. Documented from the moment the card
      // said "Esc puts it down" — and missing until a smoke run stamped one it
      // could not get rid of.
      if (event.code === 'Escape' && armedPrefabRef.current) {
        setArmedPrefabId(null);
        say('Prefab put down.');
        return;
      }

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

      // Shortcuts come from the KEYMAP now (MAP_EDITOR.md §6) rather than a
      // switch on hard-coded codes, so every one of them is rebindable.
      const action: EditorAction | null = actionFor(keymapRef.current, event.code);
      switch (action) {
        case 'toolSculpt':
          setTool('sculpt');
          break;
        case 'toolPaint':
          setTool('paint');
          break;
        case 'toolPlace':
          setTool('place');
          break;
        case 'toolZone':
          setTool('zone');
          break;
        case 'toolScatter':
          setTool('scatter');
          break;
        case 'toolMeasure':
          setTool('measure');
          break;
        case 'brushSmaller':
          adjustRadius(-2, event.shiftKey);
          break;
        case 'brushBigger':
          adjustRadius(2, event.shiftKey);
          break;
        case 'topDown':
          setCameraMode((mode) => (mode === 'top' ? 'orbit' : 'top'));
          break;
        case 'cycleOverlay':
          setOverlay((current) => nextOverlay(current));
          break;
        case 'toggleGrid':
          setShowGrid((current) => !current);
          break;
        case 'frameCursor':
          if (cursor) session.rig.frame(new THREE.Vector3(cursor.x, cursor.y ?? 0, cursor.z));
          break;
        case 'isolate':
          setIsolated((current) => !current);
          break;
        case 'deleteSelection':
          if (selectedRef.current.size > 0 && lockRef.current?.mine) {
            void session.objects
              .remove([...selectedRef.current], `Delete ${selectedRef.current.size} objects`)
              .then((ok) => {
                if (ok) setSelectedIds(new Set());
              });
          }
          break;
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
      // The import writes OBJECTS too — zones, spawners, props. Without this
      // the editor keeps showing the object list it loaded on mount, so an
      // import that restored a zone leaves the panel insisting the zone is
      // gone (and every spawner "in no zone"). The terrain reload alone was
      // the whole story here for one release; it isn't.
      await session.objects.load();
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
    // Scoped to the selected zone when there is one — MAP_EDITOR.md §3's
    // "wipe all props in Emberwood but keep terrain+spawns", which is also the
    // last beat of the §7 scenario ("wipe just its props and redecorate").
    // The server has taken a polygon since A2-b; nothing was passing it.
    const zone = selected?.layer === 'zone' ? selected : null;
    const polygon = zone ? polygonOf(zone.def) : null;
    const zoneName =
      zone && typeof zone.def.name === 'string' && zone.def.name ? zone.def.name : zone?.id;
    const where = polygon ? ` inside ${zoneName ?? 'the selected zone'}` : ' from the draft';
    if (!window.confirm(`Delete ${LAYER_LABEL[layer] ?? layer} rows${where}?`)) return;
    if (!window.confirm('This cannot be undone with Ctrl+Z. A checkpoint is taken first. Sure?')) {
      return;
    }
    try {
      const result = await apiPost<{ removed: number; checkpointId: number }>(
        '/map/objects/clear-layer',
        polygon ? { layer, polygon, zoneName } : { layer },
      );
      await sessionRef.current?.objects.load();
      setSelectedIds(new Set());
      say(
        `Cleared ${result.removed} of ${count} ${layer} rows${
          polygon ? ` in ${zoneName ?? 'the zone'}` : ''
        } (checkpoint #${result.checkpointId}).`,
      );
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
          {(
            ['sculpt', 'paint', 'water', 'board', 'place', 'scatter', 'zone', 'measure'] as ToolId[]
          ).map((id) => (
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
          ))}
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
              {placeLayer === 'interactable' && (
                <select
                  className="ws-input"
                  value={interactKind}
                  onChange={(event) => {
                    setInteractKind(event.target.value as InteractableKind);
                  }}
                >
                  {INTERACTABLE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              )}
              {placeLayer === 'node' &&
                (nodeChoices.length === 0 ? (
                  <span className="me-warn">
                    No published resource nodes — author one in Content → Professions first.
                  </span>
                ) : (
                  <select
                    className="ws-input"
                    value={activeNodeKind}
                    onChange={(event) => {
                      setNodeKind(event.target.value);
                    }}
                  >
                    {nodeChoices.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name} · T{node.tier} {node.profession}
                      </option>
                    ))}
                  </select>
                ))}
              <span className="me-hint">
                Click the ground to place. Click a marker to select it instead.
              </span>
            </>
          )}

          {tool === 'zone' && (
            <>
              {/* Picking a zone by clicking its outline works, but a border is
                  a line a few pixels wide from map height — this is the way
                  you reach for the one you mean. */}
              <select
                className="ws-input"
                value={selected?.layer === 'zone' ? selected.id : ''}
                onChange={(event) => {
                  setSelectedId(event.target.value || null);
                }}
              >
                <option value="">— pick a zone to edit —</option>
                {zoneFacts.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
              <span className="me-hint">
                {sketchLength > 0
                  ? `${sketchLength} corners — Enter closes it, Backspace undoes one, Esc cancels.`
                  : selected?.layer === 'zone'
                    ? 'Drag a corner to move it, click an edge dot to add one, Shift+click a corner to remove it.'
                    : 'Click the ground to trace a zone border, or click a zone to edit its corners.'}
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

          {tool === 'scatter' && (
            <span className="me-hint">
              {scatterBrush.setId
                ? 'Paint ground cover; hold Ctrl to clear it. Set and sizes are in the Scatter card.'
                : 'Pick a scatter set in the Scatter card first.'}
            </span>
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
          {marqueeRect && (
            <div
              className="me-marquee"
              style={{
                left: Math.min(marqueeRect.x0, marqueeRect.x1),
                top: Math.min(marqueeRect.y0, marqueeRect.y1),
                width: Math.abs(marqueeRect.x1 - marqueeRect.x0),
                height: Math.abs(marqueeRect.y1 - marqueeRect.y0),
              }}
            />
          )}
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
              {/* The centre was only settable by "Centre here" (the camera
                  pivot). Showing the numbers costs two fields and answers
                  "where is this about to land?" before you press the button —
                  and lets an islet go exactly where the coastline wants it. */}
              <NumberField
                label="centre x"
                value={island.centerX}
                min={-1024}
                max={1024}
                onChange={(centerX) => {
                  setIsland({ ...island, centerX });
                }}
              />
              <NumberField
                label="centre z"
                value={island.centerZ}
                min={-1024}
                max={1024}
                onChange={(centerZ) => {
                  setIsland({ ...island, centerZ });
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
            <h3>Spawns</h3>
            <div className="me-row">
              {(['aggro', 'leash', 'camps'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`ws-btn me-tiny${spawnOverlay[key] ? ' me-on' : ''}`}
                  onClick={() => {
                    setSpawnOverlay((current) => ({ ...current, [key]: !current[key] }));
                  }}
                >
                  {key}
                </button>
              ))}
              {selected?.layer === 'spawner' && (
                <button
                  type="button"
                  className={`ws-btn me-tiny${simulateSeed !== null ? ' me-on' : ''}`}
                  title="Ghost one spawn resolution of the selected camp"
                  onClick={() => {
                    // A NEW seed each press, so "roll again" is a real action;
                    // the same seed always previews the same camp.
                    setSimulateSeed((current) => (current === null ? 1 : current + 1));
                  }}
                >
                  {simulateSeed === null ? 'simulate' : 'roll again'}
                </button>
              )}
              {simulateSeed !== null && (
                <button
                  type="button"
                  className="ws-btn me-tiny"
                  onClick={() => {
                    setSimulateSeed(null);
                  }}
                >
                  clear
                </button>
              )}
            </div>

            <table className="me-budget">
              <tbody>
                {population.zones.map((zone) => (
                  <tr key={zone.zoneId}>
                    <td>{zone.zoneName}</td>
                    <td>
                      <b>{zone.enemies}</b> enemies
                    </td>
                    <td>
                      {zone.spawners} sp · {zone.camps} camps
                    </td>
                  </tr>
                ))}
                {population.unzoned > 0 && (
                  <tr className="me-warn">
                    <td colSpan={3}>
                      {population.unzoned} spawner{population.unzoned === 1 ? '' : 's'} in no zone
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {overlaps.length > 0 && (
              <p className="me-hint">
                {overlaps.length} camp pair{overlaps.length === 1 ? '' : 's'} pull together — widest{' '}
                {overlaps[0]?.overlapM} m ({overlaps[0]?.a} ↔ {overlaps[0]?.b}).
              </p>
            )}
            {links.length > 0 && (
              <p className="me-hint">
                Widest camp: <b>{links[0]?.tag}</b> spans {links[0]?.spreadM} m across{' '}
                {links[0]?.spawnerIds.length} spawners.
              </p>
            )}
          </section>

          <ScatterCard
            sets={scatterSets.data?.sets ?? []}
            models={placementRefs.data?.models ?? []}
            activeSetId={scatterBrush.setId}
            radius={scatterBrush.radius}
            strength={scatterBrush.strength}
            readOnly={readOnly}
            busy={busy !== null}
            onSelect={(setId) => {
              setScatterBrush((current) => ({ ...current, setId }));
              if (setId) setTool('scatter');
            }}
            onRadius={(radius) => {
              setScatterBrush((current) => ({ ...current, radius: clamp(radius, 2, 80) }));
            }}
            onStrength={(strength) => {
              setScatterBrush((current) => ({ ...current, strength: clamp(strength, 0.05, 1) }));
            }}
            onSave={(set) => {
              const sets = scatterSets.data?.sets ?? [];
              void writeScatterSets(
                sets.some((candidate) => candidate.id === set.id)
                  ? sets.map((candidate) => (candidate.id === set.id ? set : candidate))
                  : [...sets, set],
              );
            }}
            onDelete={(id) => {
              void writeScatterSets((scatterSets.data?.sets ?? []).filter((set) => set.id !== id));
              setScatterBrush((current) =>
                current.setId === id ? { ...current, setId: '' } : current,
              );
            }}
          />

          <CollectionsCard
            collections={collections.data?.collections ?? []}
            selectedCount={selectedIds.size}
            isolated={isolated}
            armedPrefabId={armedPrefabId}
            readOnly={readOnly}
            onClearSelection={() => {
              setSelectedIds(new Set());
              setIsolated(false);
            }}
            onToggleIsolate={() => {
              setIsolated((current) => !current);
            }}
            onSaveSelection={(name) => {
              void saveCollection(collectionId('sel', name), 'selection', name, {
                ids: [...selectedIds],
              });
            }}
            onLoadSelection={(ids) => {
              // Ids that no longer exist are dropped rather than kept as ghosts:
              // a set that outlived some of its objects should shrink, not lie.
              const alive = ids.filter((id) => objects.some((object) => object.id === id));
              setSelectedIds(new Set(alive));
              say(
                alive.length === ids.length
                  ? `${alive.length} selected.`
                  : `${alive.length} of ${ids.length} still exist.`,
              );
            }}
            onMakePrefab={(name) => {
              const chosen = objects.filter((object) => selectedIds.has(object.id));
              const built = makePrefab(chosen);
              if ('error' in built) {
                say(built.error);
                return;
              }
              void saveCollection(collectionId('pre', name), 'prefab', name, built);
            }}
            onArmPrefab={(id) => {
              setArmedPrefabId(id);
              if (id) say('Click the ground to stamp it.');
            }}
            onDelete={(id) => {
              void apiDelete('/map/collections', { id })
                .then(() => collections.refetch())
                .then(() => {
                  if (armedPrefabId === id) setArmedPrefabId(null);
                })
                .catch(() => {
                  say('Could not delete that.');
                });
            }}
          />

          <section className="ws-panel me-card">
            <h3>Travel</h3>
            <div className="me-row">
              <button
                type="button"
                className={`ws-btn me-tiny${showTravel ? ' me-on' : ''}`}
                title="Draw the fast-travel graph on the world"
                onClick={() => {
                  setShowTravel((current) => !current);
                }}
              >
                graph
              </button>
              <span className="me-hint">
                {shrines.length === 0
                  ? 'No shrines yet.'
                  : `${shrines.length} shrine${shrines.length === 1 ? '' : 's'}, ${hops.length} hop${hops.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {hops.length > 0 && (
              <table className="me-budget">
                <tbody>
                  {hops.slice(0, 8).map((hop) => (
                    <tr key={`${hop.from.id}:${hop.to.id}`}>
                      <td>
                        {hop.from.name} ↔ {hop.to.name}
                      </td>
                      <td>{hop.gold} g</td>
                      <td>{hop.metres} m</td>
                    </tr>
                  ))}
                  {hops.length > 8 && (
                    <tr>
                      <td colSpan={3}>…and {hops.length - 8} more</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {travelIssues.map((issue) => (
              <p key={issue.text} className="me-hint">
                {issue.text}
              </p>
            ))}
          </section>

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
                    title={
                      selected?.layer === 'zone'
                        ? `Delete every ${layer} inside the selected zone`
                        : `Delete every ${layer} in the draft`
                    }
                    onClick={() => {
                      void clearLayer(layer, count);
                    }}
                  >
                    {selected?.layer === 'zone' ? 'Clear ⌖' : 'Clear'}
                  </button>
                </div>
              );
            })}
          </section>

          <KeymapCard keymap={keymap} onChange={setKeymap} />

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

/**
 * A stable id for a saved collection: the same name overwrites rather than
 * piling up a second "Harbour props" nobody can tell from the first.
 */
const collectionId = (prefix: string, name: string): string =>
  `${prefix}_${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)}`;

const TOOL_LABELS: Record<ToolId, string> = {
  scatter: 'Scatter',
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
