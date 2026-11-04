/** Pure skirmish rules on the SOURCE hex grid. */

import {
  DIRS,
  add,
  distance,
  faceStep,
  key,
  neighbors,
  parseKey,
} from "./hex.js";
import { PLATE_ORIGINS, foundationBoard } from "./plates.js";
import {
  AMMO,
  CARD_COPIES,
  CATALOG,
  COLORS,
  MANEUVERS,
  SHIPS,
  colorById,
  sizeRank,
} from "./catalog.js";

export const ARENA_RADIUS = 4;

export function buildArena() {
  const board = foundationBoard();
  return { radius: ARENA_RADIUS, ...board };
}

export function boardSet(hexes) {
  return new Set(hexes.map((h) => key(h.q, h.r)));
}

export function starterFleet() {
  return [
    { hull: "rifter", modules: ["blasters", "nano"], ammo: ["thermal", null] },
    { hull: "rupture", modules: ["autocannons", "web", "dampener"], ammo: ["explosive", null, null] },
    { hull: "tempest", modules: ["artillery", "extender"], ammo: ["explosive", null] },
  ];
}

export function normalizeFit(entry) {
  const modules = [...(entry?.modules || [])];
  const ammo = modules.map((id, index) => {
    const spec = CATALOG[id];
    if (spec?.slot !== "weapon") return null;
    const choice = entry?.ammo?.[index];
    return spec.ammo?.includes(choice) ? choice : spec.ammo[0];
  });
  return { hull: entry?.hull, modules, ammo };
}

export function validateFleet(list) {
  if (!Array.isArray(list) || list.length !== 3) return "Bring exactly 3 ships.";
  for (const entry of list) {
    const hull = SHIPS[entry?.hull];
    if (!hull) return "Unknown hull.";
    const modules = entry.modules || [];
    if (!Array.isArray(modules)) return "Bad fitting.";
    let used = 0;
    for (const id of modules) {
      const spec = CATALOG[id];
      if (!spec) return "Unknown module.";
      const cost = spec.cost[hull.size];
      if (cost == null) return `${spec.name} does not fit a ${hull.size} hull.`;
      used += cost;
    }
    if (used > hull.racks) return `${hull.name} has ${used} rack, limit ${hull.racks}.`;
  }
  return null;
}

export function shieldMaxFor(ship, ships) {
  const base = SHIPS[ship.hull].shield;
  let bonus = 0;
  for (const other of ships) {
    if (other.playerId !== ship.playerId || other.removed || other.hullHp <= 0) continue;
    if (other.modules.includes("extender")) bonus += 1;
  }
  return base + bonus;
}

export function statLine(ship, ships) {
  const base = SHIPS[ship.hull];
  let speed = base.speed;
  let agility = base.agility;
  if (ship.modules.includes("injector")) speed += 1;
  if (ship.modules.includes("nano")) agility += 1;
  if (ship.webbed) {
    speed = Math.max(0, speed - 1);
    agility = Math.max(0, agility - 1);
  }
  return {
    ...base,
    sizeRank: sizeRank(base.size),
    speed,
    agility,
    shieldMax: shieldMaxFor(ship, ships),
    energyMax: base.energy,
    damage: base.damage,
  };
}

/** Furthest color rank. Speed 4 already reaches red. Overdrive Movement adds one rank, capped at red. */
export function travelLimit(speed, { overdrive, webbed, energy, odCooldown } = {}) {
  const base = Math.min(Math.max(0, speed), 4);
  const can =
    overdrive === "movement" && !webbed && (energy ?? 0) >= 1 && !odCooldown;
  return can ? Math.min(base + 1, 4) : base;
}

export function dirIndex(dq, dr) {
  return DIRS.findIndex((d) => d.q === dq && d.r === dr);
}

/** Facing index that steps from `from` toward `goal`. */
export function dirToward(from, goal) {
  if (from.q === goal.q && from.r === goal.r) return 0;
  const straight = faceStep(from, goal);
  if (straight) return dirIndex(straight.q, straight.r);
  let bestD = Infinity;
  let bestI = 0;
  for (let i = 0; i < DIRS.length; i++) {
    const n = add(from, DIRS[i]);
    const d = distance(n, goal);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

/**
 * Printed movement cards, relative to the ship's facing.
 * Step values are 60° clockwise from the nose: 0 forward, 1 forward-right,
 * 3 straight back, 5 forward-left. `reach` is how many of those steps each
 * color token travels (the last hex of that color on the card). `facingAt`
 * is the nose after arriving, also clockwise from the starting facing.
 * Orbit facings point at the hex two steps in front of the start.
 */
export const CARD_TEMPLATES = {
  approach: {
    steps: [0, 0, 0, 0, 0, 0],
    reach: { 1: 3, 2: 4, 3: 5, 4: 6 },
    trans: "low",
  },
  strafeRight: {
    steps: [1, 1, 1, 1, 1],
    reach: { 1: 2, 2: 3, 3: 4, 4: 5 },
    trans: "high",
  },
  strafeLeft: {
    steps: [5, 5, 5, 5, 5],
    reach: { 1: 2, 2: 3, 3: 4, 4: 5 },
    trans: "high",
  },
  keep: {
    steps: [3, 3, 3, 3, 3],
    reach: { 1: 2, 2: 3, 3: 4, 4: 5 },
    trans: "low",
  },
  orbitRight: {
    steps: [1, 1, 0, 0, 0, 5, 4, 3],
    reach: { 1: 3, 2: 5, 3: 7, 4: 8 },
    facingAt: [0, 5, 4, 4, 3, 3, 3, 3],
    trans: "high",
  },
  orbitLeft: {
    steps: [5, 5, 0, 0, 0, 1, 2, 3],
    reach: { 1: 3, 2: 5, 3: 7, 4: 8 },
    facingAt: [0, 1, 2, 2, 3, 3, 3, 3],
    trans: "high",
  },
};

/** Hexes traveled by a color token on a printed card. */
export function cardReach(card, colorId) {
  const spec = CARD_TEMPLATES[card];
  const color = colorById(colorId);
  if (!spec || !color) return 0;
  return spec.reach[color.dist] || 0;
}

/** Game directions increase counter-clockwise, so clockwise is a lower index. */
function clockDir(facing, clockwise) {
  return (facing - clockwise + 6) % 6;
}

/**
 * Path printed on the maneuver card, turned so forward matches `facing`.
 * The color token stops on the last hex of that color. Off-board steps are
 * not taken. Orbit turns the nose; the other cards leave it where it is.
 */
export function planPath({ from, facing, card, dist, color, board }) {
  const spec = CARD_TEMPLATES[card];
  const start = { q: from.q, r: from.r };
  let rank = color ? colorById(color)?.dist : dist;
  if (dist) rank = Math.min(rank || dist, dist);
  if (!spec || !rank) return { path: [start], transversal: "low", facing };
  const steps = spec.reach[rank] || 0;
  const path = [start];
  let nose = facing;
  for (let i = 0; i < steps; i++) {
    const next = add(path[path.length - 1], DIRS[clockDir(facing, spec.steps[i])]);
    if (!board.has(key(next.q, next.r))) break;
    path.push({ q: next.q, r: next.r });
    if (spec.facingAt) nose = clockDir(facing, spec.facingAt[i]);
  }
  return { path, transversal: spec.trans, facing: nose };
}

export function transversalOf(card) {
  if (card === "orbitLeft" || card === "orbitRight" || card === "strafeLeft" || card === "strafeRight") {
    return "high";
  }
  return "low";
}

export function bandAt(weapon, dist) {
  if (!weapon?.bands || dist < 1) return null;
  return weapon.bands[dist] || null;
}

/** Printed damage for a weapon at this distance. Overdrive Weapons adds 1. Overcharge turns yellow into that gun's red number. */
export function weaponShot(weapon, dist, { overdrive, overcharge } = {}) {
  const band = bandAt(weapon, dist);
  if (!band) return { quality: "miss", damage: 0, zone: "miss" };
  let zone = band[0];
  let damage = band[1];
  if (overcharge && overdrive && zone === "yellow") {
    zone = "red";
    damage = weapon.redDamage || damage;
  }
  if (overdrive) damage += 1;
  return { quality: zone, damage, zone };
}

export function freshOverdrive() {
  return { movement: false, weapons: false, shield: false };
}

export function isCooling(ship, kind) {
  return !!ship?.odCool?.[kind];
}

/**
 * Layered hit. Armor reduces the hit by 1 when the first point lands on armor.
 * An ammo bonus applies only when that first point matches the ammo's layer.
 * Explosive's bonus is knockback, and it matches hull.
 */
export function applyHit(ship, amount, { ammo } = {}) {
  let damage = Math.max(0, amount);
  const layer = ship.shield > 0 ? "shield" : (ship.armor || 0) > 0 ? "armor" : "hull";
  if (layer === "armor") damage = Math.max(0, damage - 1);
  const spec = AMMO[ammo];
  let knock = 0;
  if (spec && spec.layer === layer) {
    if (spec.bonus === "damage") damage += 1;
    if (spec.bonus === "knock") knock = 1;
  }
  let left = damage;
  const shieldBefore = ship.shield;
  const armorBefore = ship.armor || 0;
  const hullBefore = ship.hullHp;
  const shield = Math.min(ship.shield, left);
  ship.shield -= shield;
  left -= shield;
  const armor = Math.min(ship.armor || 0, left);
  ship.armor = (ship.armor || 0) - armor;
  left -= armor;
  const hull = Math.min(ship.hullHp, left);
  ship.hullHp -= hull;
  const dealt = shieldBefore - ship.shield + (armorBefore - (ship.armor || 0)) + (hullBefore - ship.hullHp);
  if (dealt > 0) ship.tookDamage = true;
  return { dealt, shield, armor, hull, knock, layer };
}

export function collisionOutcome(selfMods, selfRank, otherMods, otherRank) {
  const sizeExtra = selfRank < otherRank ? otherRank - selfRank : 0;
  let damage = 1 + sizeExtra;
  if (otherMods.includes("ram")) damage += 1;
  if (selfMods.includes("dampener")) damage -= 1;
  damage = Math.max(0, damage);
  let knock = damage;
  if (selfMods.includes("dampener")) knock -= 1;
  if (otherMods.includes("ram")) knock += 1;
  knock = Math.max(0, knock);
  return { damage, knock };
}

export function applyCombatDamage(ship, amount, { hullOnly = false } = {}) {
  let left = Math.max(0, amount);
  const shieldBefore = ship.shield;
  if (!hullOnly) {
    const absorbed = Math.min(ship.shield, left);
    ship.shield -= absorbed;
    left -= absorbed;
  }
  const hullBefore = ship.hullHp;
  ship.hullHp = Math.max(0, ship.hullHp - left);
  const dealt = shieldBefore - ship.shield + (hullBefore - ship.hullHp);
  if (dealt > 0) ship.tookDamage = true;
  return {
    dealt,
    shield: shieldBefore - ship.shield,
    hull: hullBefore - ship.hullHp,
  };
}

export function knockPath(from, dir, steps, board, blocked) {
  const path = [];
  let pos = { q: from.q, r: from.r };
  for (let i = 0; i < steps; i++) {
    const n = add(pos, DIRS[(dir + 60) % 6]);
    const k = key(n.q, n.r);
    if (!board.has(k) || blocked?.has(k)) break;
    pos = { q: n.q, r: n.r };
    path.push(pos);
  }
  return path;
}

export function nudgeFacing(facing, desired) {
  const face = ((facing % 6) + 6) % 6;
  const want = ((desired % 6) + 6) % 6;
  if (face === want) return face;
  const cw = (want - face + 6) % 6;
  const ccw = (face - want + 6) % 6;
  return cw <= ccw ? (face + 1) % 6 : (face + 5) % 6;
}

export function validateOrders(ships, orders, allShips) {
  if (!Array.isArray(orders)) return "No orders.";
  const living = ships.filter((s) => !s.removed && s.hullHp > 0);
  if (orders.length !== living.length) return "Order every ship that can still fly.";
  const seen = new Set();
  const used = {};
  for (const order of orders) {
    const ship = living.find((s) => s.id === order?.shipId);
    if (!ship || seen.has(ship.id)) return "Each flying ship orders once.";
    seen.add(ship.id);
    const stats = statLine(ship, allShips);
    const turn = Number(order.turn) || 0;
    if (!Number.isInteger(turn) || turn < 0 || turn > stats.agility) {
      return `${ship.name} can turn at most ${stats.agility}.`;
    }
    if (turn > 0 && order.turnDir !== "left" && order.turnDir !== "right") {
      return `${ship.name} needs a turn direction.`;
    }
    const card = order.card;
    const spend = card === "hold" ? order.holdSpend : card;
    if (card !== "hold" && !MANEUVERS.includes(card)) return `${ship.name} needs a maneuver.`;
    if (card === "hold" && !MANEUVERS.includes(spend)) return `${ship.name} must place a card face-down to hold.`;
    used[spend] = (used[spend] || 0) + 1;
    if (used[spend] > CARD_COPIES) return `Only ${CARD_COPIES} ${spend} cards.`;
    if (card === "hold" && (order.overdrive || order.active)) {
      return `${ship.name} holds and cannot act.`;
    }
    if (order.overdrive) {
      if (!["movement", "weapons", "shield"].includes(order.overdrive)) return "Unknown Overdrive.";
      if (isCooling(ship, order.overdrive)) {
        return `${ship.name} must Hold before that Overdrive is ready.`;
      }
      if (ship.energy < 1) return `${ship.name} has no energy.`;
      if (order.overdrive === "movement" && ship.webbed) return `${ship.name} is webbed and cannot Overdrive Movement.`;
    }
    if (card !== "hold") {
      const color = colorById(order.color);
      if (!color) return `${ship.name} needs a color token.`;
      const limit = travelLimit(stats.speed, {
        overdrive: order.overdrive,
        webbed: ship.webbed,
        energy: ship.energy,
        odCooldown: isCooling(ship, "movement"),
      });
      if (color.dist > limit || color.dist < 1) {
        return `${ship.name} cannot play ${color.name}.`;
      }
    }
    if (order.active) {
      const id = order.active.id;
      const spec = CATALOG[id];
      if (!spec || spec.slot !== "active") return "That module is not active.";
      if (!ship.modules.includes(id)) return `${ship.name} does not fit ${spec.name}.`;
      if (ship.spent?.[id]) return `${spec.name} is spent until you Hold.`;
      if ((id === "neut" || id === "web") && !order.active.targetId) return `${spec.name} needs a target.`;
    }
  }
  return null;
}

export function weaponAt(ship, index) {
  const id = ship.modules[index];
  const spec = CATALOG[id];
  if (!spec || spec.slot !== "weapon") return null;
  const ammo = ship.ammo?.[index] || spec.ammo?.[0] || null;
  return { index, id, ...spec, ammo };
}

export function inWeaponRange(weapon, dist) {
  return !!bandAt(weapon, dist);
}

export function deploymentSlots(count, board, foundations = PLATE_ORIGINS) {
  const plates = (foundations.length ? foundations : PLATE_ORIGINS).map((p) => ({ q: p.q, r: p.r }));
  const order = [0, 3, 1, 2].filter((index) => plates[index]);
  while (order.length < count) order.push(order.length % plates.length);
  const center = {
    q: Math.round(plates.reduce((sum, plate) => sum + plate.q, 0) / plates.length),
    r: Math.round(plates.reduce((sum, plate) => sum + plate.r, 0) / plates.length),
  };
  const used = new Set();
  const cells = [...board].map((id) => parseKey(id));
  return order.slice(0, count).map((index) => {
    const plate = plates[index];
    const outward = dirToward(center, plate);
    const goal = add(plate, DIRS[outward]);
    const near = cells
      .filter((cell) => !used.has(key(cell.q, cell.r)))
      .sort((a, b) => distance(a, goal) - distance(b, goal) || distance(a, plate) - distance(b, plate));
    const ships = [];
    for (const cell of near) {
      if (ships.length === 3) break;
      used.add(key(cell.q, cell.r));
      ships.push({ q: cell.q, r: cell.r, facing: dirToward(cell, center) });
    }
    return ships;
  });
}

export { COLORS };
