import { key, ring, distance, neighbors } from "../shared/hex.js";
import { pickN, shuffle } from "../shared/rng.js";
import { FRUIT } from "../shared/constants.js";

const STARTS = {
  2: [
    { q: 3, r: -3 },
    { q: -3, r: 3 },
  ],
  3: [
    { q: 3, r: -3 },
    { q: -3, r: 0 },
    { q: -1, r: 3 },
  ],
  4: [
    { q: 3, r: -3 },
    { q: 3, r: 0 },
    { q: -3, r: 3 },
    { q: -3, r: 0 },
  ],
};

export function startSpots(playerCount) {
  return STARTS[playerCount] || STARTS[2];
}

/** 2–5 players use one plate. 6–10 add a second plate on the short side. */
export function foundationCount(playerCount) {
  const n = playerCount || 0;
  if (n >= 6) return 2;
  return 1;
}

/**
 * Plate centers. A step of 6 in r puts the next foundation against the short
 * side of this one: the rims touch, and two hexes connect the islands.
 * Four plates use that short step plus a step of (8, -4) along the long side,
 * so they sit as a square instead of a row.
 */
const LONG_STEP = { q: 8, r: -4 };
/** Hexes the two long rims cover together. They are the walkway between columns. */
const LONG_BRIDGE = [
  { q: 4, r: -4 },
  { q: 4, r: -3 },
  { q: 4, r: -2 },
  { q: 4, r: -1 },
  { q: 4, r: 0 },
];

export function plateOrigins(count) {
  if (count >= 4) {
    return [
      { q: -4, r: -1 },
      { q: -4, r: 5 },
      { q: 4, r: -5 },
      { q: 4, r: 1 },
    ];
  }
  if (count === 2) {
    return [
      { q: 0, r: -3 },
      { q: 0, r: 3 },
    ];
  }
  return [{ q: 0, r: 0 }];
}

/**
 * Tips the plate cuts through. A slime would stand on a hex the mesh only
 * partly covers, so they are not spaces.
 * Measured on public/models/foundation.obj after foundationPose().
 */
const CLIPPED_EDGES = [
  { q: 0, r: -3 },
  { q: 0, r: 3 },
];

/**
 * Full pads past the radius-3 ring. The plate covers these the same way it
 * covers the cells inside the ring.
 */
const FULL_EDGES = [
  { q: 3, r: -4 },
  { q: -3, r: -1 },
  { q: 3, r: 1 },
  { q: -3, r: 4 },
];

function islandCells() {
  const clipped = new Set(CLIPPED_EDGES.map((h) => key(h.q, h.r)));
  const cells = ring(3).filter((h) => !clipped.has(key(h.q, h.r)));
  return cells.concat(FULL_EDGES);
}

export function buildBoard(playerCount, rand) {
  const origins = plateOrigins(foundationCount(playerCount));
  const local = islandCells();
  const map = {};
  origins.forEach((origin, plate) => {
    for (const h of local) {
      const q = h.q + origin.q;
      const r = h.r + origin.r;
      const k = key(q, r);
      if (map[k]) continue;
      map[k] = { q, r, terrain: "open", elevation: 0, plate };
    }
  });
  addLongBridges(map, origins);

  const seam = seamKeys(map);
  const starts =
    origins.length === 1 && startSpots(playerCount).length >= playerCount
      ? startSpots(playerCount).map((s) => ({ q: s.q, r: s.r }))
      : spreadStarts(map, playerCount, rand);
  const startKeys = new Set(starts.map((s) => key(s.q, s.r)));

  for (let plate = 0; plate < origins.length; plate++) {
    fillPlate(map, plate, rand, startKeys, seam);
  }
  restoreConnectivity(map, starts);
  clearStartExits(map, starts);
  for (let plate = 0; plate < origins.length; plate++) {
    fillPlate(map, plate, rand, startKeys, seam, starts);
  }

  // Fruit and crystals only sit on open ground. A tree hex never holds one.
  // Crystals are reserved first: two on each foundation, on flat ground.
  const blocked = new Set();
  const captures = [];
  for (let plate = 0; plate < origins.length; plate++) {
    const onPlate = (c) =>
      c.plate === plate &&
      (c.elevation || 0) === 0 &&
      !origins.some((origin) => origin.q === c.q && origin.r === c.r);
    const capKeys = takeClearings(map, startKeys, blocked, 2, rand, onPlate);
    for (const k of capKeys) {
      captures.push({
        id: `c${captures.length}`,
        q: map[k].q,
        r: map[k].r,
        claimedBy: [],
      });
    }
  }

  const fruitTypes = [];
  for (let i = 0; i < playerCount; i++) {
    fruitTypes.push("apple", "banana", "grapes");
  }
  const fruitKeys = takeClearings(map, startKeys, blocked, fruitTypes.length, rand);
  const fruits = fruitKeys.map((k, i) => {
    const type = fruitTypes[i];
    return {
      id: `f${i}`,
      q: map[k].q,
      r: map[k].r,
      type,
      value: FRUIT[type].value,
    };
  });
  shiftOntoClearings(fruits, map, startKeys, blocked, rand);
  for (let plate = 0; plate < origins.length; plate++) {
    const mine = captures.filter((c) => map[key(c.q, c.r)]?.plate === plate);
    shiftOntoClearings(mine, map, startKeys, blocked, rand, (c) =>
      c.plate === plate && (c.elevation || 0) === 0
    );
  }

  for (const cell of Object.values(map)) delete cell.plate;

  return {
    hexes: map,
    fruits,
    captures,
    starts,
    foundations: origins,
  };
}

function addLongBridges(map, origins) {
  for (const origin of origins) {
    const next = origins.some((o) => o.q === origin.q + LONG_STEP.q && o.r === origin.r + LONG_STEP.r);
    if (!next) continue;
    for (const step of LONG_BRIDGE) {
      const q = origin.q + step.q;
      const r = origin.r + step.r;
      const k = key(q, r);
      if (map[k]) continue;
      map[k] = { q, r, terrain: "open", elevation: 0, plate: -1 };
    }
  }
}

function seamKeys(map) {
  const seam = new Set();
  for (const cell of Object.values(map)) {
    for (const n of neighbors(cell)) {
      const other = map[key(n.q, n.r)];
      if (!other || other.plate === cell.plate) continue;
      seam.add(key(cell.q, cell.r));
      seam.add(key(other.q, other.r));
    }
  }
  return seam;
}

function spreadStarts(map, count, rand) {
  const cells = Object.values(map);
  const edge = cells.filter(
    (c) => neighbors(c).filter((n) => map[key(n.q, n.r)]).length <= 4
  );
  let pool = shuffle(edge.length >= count ? edge : cells, rand);
  const chosen = [];
  while (chosen.length < count && pool.length) {
    let best = pool[0];
    let bestD = -1;
    for (const c of pool) {
      const d = chosen.reduce((min, s) => Math.min(min, distance(c, s)), 99);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    chosen.push({ q: best.q, r: best.r });
    pool = pool.filter((c) => c.q !== best.q || c.r !== best.r);
  }
  return chosen;
}

function takeClearings(map, startKeys, blocked, n, rand, extra) {
  const pool = Object.keys(map).filter((k) => {
    const cell = map[k];
    if (!cell || cell.terrain !== "open" || startKeys.has(k) || blocked.has(k)) return false;
    return extra ? extra(cell, k) : true;
  });
  const chosen = pickN(pool, n, rand);
  for (const k of chosen) blocked.add(k);
  return chosen;
}

function shiftOntoClearings(items, map, startKeys, blocked, rand, extra) {
  for (const item of items) {
    const here = key(item.q, item.r);
    const cell = map[here];
    const ok =
      cell && cell.terrain === "open" && !startKeys.has(here) && (!extra || extra(cell, here));
    if (ok) continue;
    blocked.delete(here);
    const next = takeClearings(map, startKeys, blocked, 1, rand, extra)[0];
    if (!next) continue;
    item.q = map[next].q;
    item.r = map[next].r;
  }
}

/** Each foundation keeps two crystals, and at least four trees, hills, and pools. */
const MIN_TERRAIN = 4;

function countWhere(map, plate, pred) {
  let n = 0;
  for (const cell of Object.values(map)) {
    if (cell.plate === plate && pred(cell)) n += 1;
  }
  return n;
}

function openFlatKeys(map, plate, startKeys, extra) {
  const keys = [];
  for (const [k, cell] of Object.entries(map)) {
    if (cell.plate !== plate || cell.terrain !== "open" || (cell.elevation || 0) !== 0) continue;
    if (startKeys.has(k)) continue;
    if (extra && !extra(cell, k)) continue;
    keys.push(k);
  }
  return keys;
}

function touchesStart(cell, startKeys) {
  return neighbors(cell).some((n) => startKeys.has(key(n.q, n.r)));
}

function canTree(map, k, starts) {
  const cell = map[k];
  const prev = cell.terrain;
  cell.terrain = "tree";
  const reach = from(map, starts[0], (h) => h && h.terrain !== "tree");
  let ok = true;
  for (const other of Object.values(map)) {
    if (other.terrain === "tree") continue;
    if (!reach.has(key(other.q, other.r))) {
      ok = false;
      break;
    }
  }
  cell.terrain = prev;
  return ok;
}

function fillPlate(map, plate, rand, startKeys, seam, starts) {
  const needTrees = MIN_TERRAIN - countWhere(map, plate, (c) => c.terrain === "tree");
  if (needTrees > 0) {
    const away = openFlatKeys(
      map,
      plate,
      startKeys,
      (c, k) => !seam.has(k) && !touchesStart(c, startKeys) && (!starts || canTree(map, k, starts))
    );
    const offSeam = openFlatKeys(
      map,
      plate,
      startKeys,
      (c, k) => !seam.has(k) && (!starts || canTree(map, k, starts))
    );
    const any = openFlatKeys(map, plate, startKeys, (c, k) => !starts || canTree(map, k, starts));
    const pool = away.length >= needTrees ? away : offSeam.length >= needTrees ? offSeam : any;
    let placed = 0;
    for (const k of pickN(pool, pool.length, rand)) {
      if (placed >= needTrees) break;
      if (starts && !canTree(map, k, starts)) continue;
      map[k].terrain = "tree";
      placed += 1;
    }
  }

  const needWater = MIN_TERRAIN - countWhere(map, plate, (c) => c.terrain === "water");
  if (needWater > 0) {
    for (const k of pickN(openFlatKeys(map, plate, startKeys), needWater, rand)) {
      map[k].terrain = "water";
      map[k].elevation = -1;
    }
  }

  const needHeight = MIN_TERRAIN - countWhere(map, plate, (c) => (c.elevation || 0) > 0);
  if (needHeight > 0) {
    for (const k of pickN(openFlatKeys(map, plate, startKeys), needHeight, rand)) {
      map[k].elevation = 1;
    }
  }
}

function clearStartExits(map, starts) {
  for (const s of starts) {
    const cell = map[key(s.q, s.r)];
    if (cell) {
      cell.terrain = "open";
      cell.elevation = 0;
    }
    for (const n of neighbors(s)) {
      const nk = key(n.q, n.r);
      if (map[nk] && map[nk].terrain === "tree") map[nk].terrain = "open";
    }
  }
}

function restoreConnectivity(map, starts) {
  const walkable = (h) => h && h.terrain !== "tree";
  const reach = from(map, starts[0], walkable);
  const blocked = Object.values(map).filter(
    (h) => h.terrain !== "tree" && !reach.has(key(h.q, h.r))
  );
  for (const h of blocked) {
    const nk = neighborsOnMap(map, h).find((n) => map[n]?.terrain === "tree");
    if (nk) map[nk].terrain = "open";
  }
  for (const s of starts) {
    const cell = map[key(s.q, s.r)];
    if (cell) {
      cell.terrain = "open";
      cell.elevation = 0;
    }
  }
}

function neighborsOnMap(map, h) {
  const dirs = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  return dirs
    .map(([dq, dr]) => key(h.q + dq, h.r + dr))
    .filter((k) => map[k]);
}

function from(map, start, walkable) {
  const seen = new Set();
  const q = [key(start.q, start.r)];
  seen.add(q[0]);
  while (q.length) {
    const k = q.shift();
    const h = map[k];
    if (!h || !walkable(h)) continue;
    for (const n of neighborsOnMap(map, h)) {
      if (seen.has(n)) continue;
      if (!walkable(map[n])) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

export function hexCount(hexes) {
  return Object.keys(hexes).length;
}
