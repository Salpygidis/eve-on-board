/** Pure skirmish rules on the SOURCE hex grid. */

import {
  DIRS,
  add,
  distance,
  faceStep,
  key,
  neighbors,
  ring,
} from "./hex.js";
import {
  CARD_COPIES,
  CATALOG,
  COLORS,
  KEEP_RANGE,
  MANEUVERS,
  SHIPS,
  colorById,
  sizeRank,
} from "./catalog.js";

export const ARENA_RADIUS = 4;

export function buildArena(radius = ARENA_RADIUS) {
  const hexes = ring(radius).map((h) => {
    const d = distance(h, { q: 0, r: 0 });
    let tint = "#152238";
    if (d === 0) tint = "#2a4170";
    else if ((d + h.q + h.r) % 2 === 0) tint = "#1b2c4d";
    return { q: h.q, r: h.r, terrain: "void", elevation: 0, tint };
  });
  return { radius, hexes };
}

export function boardSet(hexes) {
  return new Set(hexes.map((h) => key(h.q, h.r)));
}

export function starterFleet() {
  return [
    { hull: "rifter", modules: ["blasters", "nano"] },
    { hull: "rupture", modules: ["autocannons", "web", "dampener"] },
    { hull: "tempest", modules: ["artillery", "extender"] },
  ];
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

/** Furthest legal color distance. Red (4) only exists as the Overdrive step past 3. */
export function travelLimit(speed, { overdrive, webbed, energy, odCooldown } = {}) {
  const base = Math.min(Math.max(0, speed), 3);
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

function closest(pos, goal) {
  let best = null;
  let bestD = Infinity;
  for (const n of neighbors(pos)) {
    const d = distance(n, goal);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function farthest(pos, goal) {
  let best = null;
  let bestD = -1;
  for (const n of neighbors(pos)) {
    const d = distance(n, goal);
    if (d > bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function stepOf(pos, facing, card, target, prefer) {
  if (card === "strafeLeft" || card === "strafeRight") {
    const sign = card === "strafeRight" ? 1 : -1;
    return add(pos, DIRS[(facing + sign * 2 + 60) % 6]);
  }
  if (card === "approach") {
    if (!target) return add(pos, DIRS[facing]);
    if (distance(pos, target) <= 1) return null;
    return closest(pos, target);
  }
  if (card === "keep") {
    if (!target) return null;
    const d = distance(pos, target);
    if (d > prefer) return closest(pos, target);
    if (d < prefer) return farthest(pos, target);
    return null;
  }
  if (card === "orbitLeft" || card === "orbitRight") {
    if (!target || (target.q === pos.q && target.r === pos.r)) return add(pos, DIRS[facing]);
    const sign = card === "orbitRight" ? 1 : -1;
    const away = dirToward(target, pos);
    return add(pos, DIRS[(away + sign * 2 + 60) % 6]);
  }
  return null;
}

/**
 * Simultaneous path from the plotting position. The focus is where the
 * target started this round. Ships may pass through hexes; they do not
 * enter the focus ship's hex.
 */
export function planPath({ from, facing, card, dist, target, board, prefer = KEEP_RANGE }) {
  const path = [{ q: from.q, r: from.r }];
  const high = card === "orbitLeft" || card === "orbitRight" || card === "strafeLeft" || card === "strafeRight";
  if (card === "hold" || !dist) return { path, transversal: "low" };
  let pos = path[0];
  for (let i = 0; i < dist; i++) {
    const next = stepOf(pos, facing, card, target, prefer);
    if (!next || !board.has(key(next.q, next.r))) break;
    if (target && next.q === target.q && next.r === target.r) break;
    pos = { q: next.q, r: next.r };
    path.push(pos);
  }
  return { path, transversal: high ? "high" : "low" };
}

export function transversalOf(card) {
  if (card === "orbitLeft" || card === "orbitRight" || card === "strafeLeft" || card === "strafeRight") {
    return "high";
  }
  return "low";
}

export function engagement(dist, weapon, transversal) {
  if (dist <= weapon.optimal) return transversal === "high" ? "yellow" : "red";
  if (dist <= weapon.optimal + weapon.falloff) return transversal === "low" ? "yellow" : "miss";
  return "miss";
}

export function shotDamage(base, quality, { overdrive, overcharge } = {}) {
  if (quality === "miss") return { quality: "miss", damage: 0, raw: "miss" };
  let q = quality;
  if (overcharge && overdrive && q === "yellow") q = "red";
  let damage = q === "red" ? base : Math.max(0, base - 1);
  if (overdrive) damage += 2;
  return { quality: q, damage, raw: quality };
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
    const refreshed = card === "hold";
    if (order.overdrive) {
      if (!["movement", "weapons", "shield"].includes(order.overdrive)) return "Unknown Overdrive.";
      if (ship.odCooldown && !refreshed) return `${ship.name} must Hold before Overdrive is ready.`;
      const energy = refreshed ? stats.energyMax : ship.energy;
      if (energy < 1) return `${ship.name} has no energy.`;
      if (order.overdrive === "movement" && ship.webbed) return `${ship.name} is webbed and cannot Overdrive Movement.`;
      if (order.overdrive === "movement" && card === "hold") return "Hold does not Overdrive Movement.";
    }
    if (card !== "hold") {
      const color = colorById(order.color);
      if (!color) return `${ship.name} needs a color token.`;
      const limit = travelLimit(stats.speed, {
        overdrive: order.overdrive,
        webbed: ship.webbed,
        energy: ship.energy,
        odCooldown: ship.odCooldown,
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
      if (ship.spent?.[id] && order.card !== "hold") return `${spec.name} is spent until you Hold.`;
      if ((id === "neut" || id === "web") && !order.active.targetId) return `${spec.name} needs a target.`;
      if (id === "overcharge" && order.overdrive !== "weapons") {
        return "Weapon Overcharge requires Weapons Overdrive.";
      }
    }
  }
  return null;
}

export function weaponAt(ship, index) {
  const id = ship.modules[index];
  const spec = CATALOG[id];
  if (!spec || spec.slot !== "weapon") return null;
  return { index, id, ...spec };
}

export function inWeaponRange(weapon, dist) {
  return dist <= weapon.optimal + weapon.falloff;
}

export function deploymentSlots(count, board) {
  const radius = ARENA_RADIUS;
  const used = new Set();
  const slots = [];
  const freeNear = (origin) => {
    const queue = [origin];
    const seen = new Set([key(origin.q, origin.r)]);
    while (queue.length) {
      const h = queue.shift();
      const k = key(h.q, h.r);
      if (board.has(k) && !used.has(k)) return h;
      for (const n of neighbors(h)) {
        const nk = key(n.q, n.r);
        if (seen.has(nk)) continue;
        seen.add(nk);
        if (distance(n, origin) > radius + 1) continue;
        queue.push(n);
      }
    }
    return null;
  };
  for (let p = 0; p < count; p++) {
    const dir = Math.floor((p * 6) / count) % 6;
    const inward = (dir + 3) % 6;
    const side = (dir + 2) % 6;
    const origin = {
      q: DIRS[dir].q * (radius - 1),
      r: DIRS[dir].r * (radius - 1),
    };
    const ships = [];
    for (const off of [-1, 0, 1]) {
      const guess = {
        q: origin.q + DIRS[side].q * off,
        r: origin.r + DIRS[side].r * off,
      };
      const spot = board.has(key(guess.q, guess.r)) && !used.has(key(guess.q, guess.r))
        ? guess
        : freeNear(origin);
      if (!spot) continue;
      used.add(key(spot.q, spot.r));
      ships.push({ q: spot.q, r: spot.r, facing: inward });
    }
    slots.push(ships);
  }
  return slots;
}

export { COLORS };
