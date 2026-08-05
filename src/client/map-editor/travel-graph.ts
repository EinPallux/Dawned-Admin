/**
 * The shrine / fast-travel graph (A3-c · MAP_EDITOR.md §2.4).
 *
 * WORLD.md §4.2 makes shrines the whole travel model — respawn anchor plus the
 * only way to cross the island quickly — and ITEMS_LOOT.md §5 prices a hop at
 * `2 × distance-in-chunks`. Both of those are decisions the owner makes with
 * their MOUSE, by choosing where a shrine stands, and neither is visible from a
 * list of rows: two shrines 90 m apart make a 5 g hop that trivialises the walk
 * between them, and a lone shrine in a new zone is a respawn point players
 * cannot travel to.
 *
 * The price comes from `@dawned/shared` (`fastTravelCost`), never from a copy
 * here — the panel must not quote a number the game will not charge.
 */

import { fastTravelCost, travelHops, type TravelHop, type TravelNode } from '@dawned/shared';
import type { PlacedObject } from './placement.js';

export type { TravelHop, TravelNode };
export { fastTravelCost };

/** A placed shrine, whether or not it joined the travel graph. */
export interface Shrine extends TravelNode {
  /** `travelNode` on the interactable row — off means "respawn only". */
  onGraph: boolean;
}

/**
 * Every shrine in the draft, in placement order.
 *
 * Reads the raw def rather than parsing through `interactableSchema`: a
 * half-edited row must still show up on the map, because the panel that draws
 * it is the panel you fix it in.
 */
export const shrinesFrom = (objects: readonly PlacedObject[]): Shrine[] => {
  const out: Shrine[] = [];
  for (const object of objects) {
    if (object.layer !== 'interactable') continue;
    if (object.def.kind !== 'shrine') continue;
    if (object.x === null || object.z === null) continue;
    out.push({
      id: object.id,
      name: typeof object.def.name === 'string' && object.def.name ? object.def.name : object.id,
      x: object.x,
      z: object.z,
      onGraph: object.def.travelNode === true,
    });
  }
  return out;
};

/** The graph itself: only shrines that opted in can be travelled between. */
export const graphNodes = (shrines: readonly Shrine[]): TravelNode[] =>
  shrines.filter((shrine) => shrine.onGraph).map(({ id, name, x, z }) => ({ id, name, x, z }));

export const graphHops = (shrines: readonly Shrine[]): TravelHop[] =>
  travelHops(graphNodes(shrines));

export interface TravelProblem {
  /** `warn` reads as advice; `error` means the map is broken as authored. */
  level: 'warn' | 'error';
  text: string;
}

/**
 * What is wrong with the travel graph as it stands.
 *
 * Everything here is a JUDGEMENT call, so nothing here blocks a publish — the
 * hard gates (a shrine nobody can walk to, a chest with no table) live in the
 * bake's validator. These are the things the owner would want pointed out while
 * they still have the mouse in their hand.
 */
export const travelProblems = (shrines: readonly Shrine[]): TravelProblem[] => {
  const problems: TravelProblem[] = [];
  const onGraph = shrines.filter((shrine) => shrine.onGraph);

  if (shrines.length === 0) {
    problems.push({
      level: 'warn',
      text: 'no shrines: players respawn at the world spawn and can never fast travel',
    });
    return problems;
  }
  if (onGraph.length === 0) {
    problems.push({
      level: 'warn',
      text: `${shrines.length} shrine${shrines.length === 1 ? '' : 's'} placed, none on the travel graph`,
    });
  } else if (onGraph.length === 1) {
    problems.push({
      level: 'warn',
      text: `only ${onGraph[0]!.name} is on the graph — there is nowhere to travel to`,
    });
  }
  for (const shrine of shrines) {
    if (!shrine.onGraph) {
      problems.push({ level: 'warn', text: `${shrine.name} is a respawn point only` });
    }
  }

  // Two shrines close enough that the hop costs the floor are a walk, not a
  // decision — the sink is meaningless and the world stops being walked.
  for (const hop of graphHops(shrines)) {
    if (hop.metres < 120) {
      problems.push({
        level: 'warn',
        text: `${hop.from.name} and ${hop.to.name} are ${hop.metres} m apart — a ${hop.gold} g hop nobody will pay for`,
      });
    }
  }
  return problems;
};
