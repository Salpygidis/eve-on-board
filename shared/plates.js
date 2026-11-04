/** Four copies of foundation.obj, joined into a square. */

import { key, ring } from "./hex.js";

/**
 * Centers measured so the long rims face each other and the short rims touch.
 * A step of 6 in r joins a short side. A step of (8, -4) joins a long side.
 */
export const PLATE_ORIGINS = [
  { q: -4, r: -1 },
  { q: -4, r: 5 },
  { q: 4, r: -5 },
  { q: 4, r: 1 },
];

const LONG_STEP = { q: 8, r: -4 };
const LONG_BRIDGE = [
  { q: 4, r: -4 },
  { q: 4, r: -3 },
  { q: 4, r: -2 },
  { q: 4, r: -1 },
  { q: 4, r: 0 },
];

/** Tips the mesh only partly covers. They are not spaces. */
const CLIPPED_EDGES = [
  { q: 0, r: -3 },
  { q: 0, r: 3 },
];

/** Full pads just outside the radius-3 ring. */
const FULL_EDGES = [
  { q: 3, r: -4 },
  { q: -3, r: -1 },
  { q: 3, r: 1 },
  { q: -3, r: 4 },
];

function islandCells() {
  const clipped = new Set(CLIPPED_EDGES.map((h) => key(h.q, h.r)));
  return ring(3).filter((h) => !clipped.has(key(h.q, h.r))).concat(FULL_EDGES);
}

/** Playable hexes covered by four foundation plates, plus the walkways between columns. */
export function foundationBoard() {
  const local = islandCells();
  const map = new Map();
  const put = (q, r) => {
    const id = key(q, r);
    if (map.has(id)) return;
    map.set(id, { q, r, terrain: "open", elevation: 0 });
  };
  for (const origin of PLATE_ORIGINS) {
    for (const cell of local) put(cell.q + origin.q, cell.r + origin.r);
  }
  for (const origin of PLATE_ORIGINS) {
    const joined = PLATE_ORIGINS.some(
      (other) => other.q === origin.q + LONG_STEP.q && other.r === origin.r + LONG_STEP.r
    );
    if (!joined) continue;
    for (const step of LONG_BRIDGE) put(origin.q + step.q, origin.r + step.r);
  }
  return {
    foundations: PLATE_ORIGINS.map((origin) => ({ q: origin.q, r: origin.r })),
    hexes: [...map.values()],
  };
}
