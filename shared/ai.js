/** Legal default orders for bots and the suggestion button. */

import { distance, key } from "./hex.js";
import { CATALOG, MANEUVERS, colorById } from "./catalog.js";
import {
  boardSet,
  planPath,
  statLine,
  travelLimit,
  dirToward,
  weaponAt,
} from "./rules.js";

function nearestEnemy(ship, ships) {
  let best = null;
  let bestD = Infinity;
  for (const other of ships) {
    if (other.playerId === ship.playerId || other.removed || other.hullHp <= 0) continue;
    const d = distance(ship, other);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best ? { ship: best, dist: bestD } : null;
}

function bestColor(stats, ship, want) {
  const limit = travelLimit(stats.speed, {
    overdrive: "movement",
    webbed: ship.webbed,
    energy: ship.energy,
    odCooldown: ship.odCooldown,
  });
  const plain = travelLimit(stats.speed, {
    webbed: ship.webbed,
    energy: ship.energy,
    odCooldown: ship.odCooldown,
  });
  let choice = null;
  let drive = false;
  for (const color of [
    { id: "lb", dist: 1 },
    { id: "lg", dist: 2 },
    { id: "y", dist: 3 },
    { id: "r", dist: 4 },
  ]) {
    if (color.dist > want) continue;
    if (color.dist <= plain) {
      choice = color.id;
      drive = false;
    } else if (color.dist <= limit) {
      choice = color.id;
      drive = true;
    }
  }
  if (!choice) return { color: "lb", movement: false, dist: Math.min(plain, 1) };
  return { color: choice, movement: drive, dist: drive ? limit : plain };
}

function take(used, card) {
  if ((used[card] || 0) >= 2) return false;
  used[card] = (used[card] || 0) + 1;
  return true;
}

export function suggestOrders(game, playerId) {
  const ships = (game.ships || []).filter((s) => s.playerId === playerId && !s.removed && s.hullHp > 0);
  const used = {};
  return ships.map((ship) => {
    const stats = statLine(ship, game.ships);
    const foe = nearestEnemy(ship, game.ships);
    const weapons = ship.modules
      .map((id, index) => weaponAt(ship, index))
      .filter(Boolean);
    const optimal = weapons.reduce((m, w) => Math.max(m, w.optimal), 1);
    const reach = weapons.reduce((m, w) => Math.max(m, w.optimal + w.falloff), 0);
    let desired = "approach";
    let want = foe ? Math.max(1, foe.dist - Math.max(1, optimal)) : 1;
    if (!foe) {
      desired = "hold";
      want = 0;
    } else if (foe.dist > optimal) {
      desired = "approach";
      want = Math.max(1, foe.dist - optimal);
    } else if (optimal >= 4 && foe.dist < optimal - 1) {
      desired = "keep";
      want = Math.max(1, optimal - foe.dist);
    } else {
      desired = "orbitRight";
      want = 2;
    }
    let card = desired;
    let holdSpend = null;
    if (card !== "hold" && !take(used, card)) {
      const fallback = MANEUVERS.find((id) => take(used, id));
      if (fallback) card = fallback;
      else {
        card = "hold";
        holdSpend = MANEUVERS.find((id) => (used[id] || 0) < 2) || "approach";
        used[holdSpend] = (used[holdSpend] || 0) + 1;
      }
    }
    if (card === "hold" && !holdSpend) {
      holdSpend = MANEUVERS.find((id) => (used[id] || 0) < 2) || "approach";
      used[holdSpend] = (used[holdSpend] || 0) + 1;
    }
    const picked = card === "hold" ? { color: "lb", movement: false } : bestColor(stats, ship, Math.max(want, 1));
    if (card !== "hold" && picked.dist <= 0) {
      holdSpend = card;
      card = "hold";
    }
    let overdrive = null;
    const canDrive = !ship.odCooldown && ship.energy >= 1 && !ship.webbed;
    if (card !== "hold" && picked.movement && canDrive) overdrive = "movement";
    else if (!ship.odCooldown && ship.energy >= 1 && foe && foe.dist <= reach) overdrive = "weapons";
    else if (!ship.odCooldown && ship.energy >= 1 && ship.shield < stats.shieldMax) overdrive = "shield";

    let active = null;
    const spent = ship.spent || {};
    if (foe && ship.modules.includes("web") && !spent.web && foe.dist <= 5 && !foe.webbed && !foe.webNext) {
      active = { id: "web", targetId: foe.ship.id };
    } else if (foe && ship.modules.includes("neut") && !spent.neut && foe.dist <= 5 && foe.energy > 0) {
      active = { id: "neut", targetId: foe.ship.id };
    } else if (ship.modules.includes("overcharge") && !spent.overcharge && overdrive === "weapons") {
      active = { id: "overcharge" };
    } else if (foe && ship.modules.includes("bomb") && !spent.bomb && foe.dist <= 2) {
      active = { id: "bomb" };
    } else if (ship.modules.includes("stealth") && !spent.stealth && ship.hullHp <= Math.ceil(ship.hullMax / 2)) {
      active = { id: "stealth" };
    }

    let turn = 0;
    let turnDir = "none";
    if (foe && stats.agility > 0) {
      const desiredDir = dirToward(ship, foe.ship);
      const cw = (desiredDir - ship.facing + 6) % 6;
      const ccw = (ship.facing - desiredDir + 6) % 6;
      if (desiredDir !== ship.facing) {
        if (cw <= ccw) {
          turn = Math.min(stats.agility, cw);
          turnDir = "right";
        } else {
          turn = Math.min(stats.agility, ccw);
          turnDir = "left";
        }
      }
    }

    return {
      shipId: ship.id,
      turn,
      turnDir,
      card,
      holdSpend,
      color: picked.color,
      overdrive,
      active,
      focusId: foe?.ship.id || null,
      useGyro: true,
    };
  });
}

export function suggestAttacks(game, playerId) {
  const ships = (game.ships || []).filter((s) => s.playerId === playerId && !s.removed && !s.collisionKilled);
  const attacks = [];
  for (const ship of ships) {
    if (ship.hullHp <= 0 && !ship.pendingBombDeath) continue;
    const options = [];
    ship.modules.forEach((id, index) => {
      const weapon = weaponAt(ship, index);
      if (!weapon) return;
      for (const other of game.ships) {
        if (other.playerId === ship.playerId || other.removed || other.collisionKilled || other.hullHp <= 0) continue;
        if (other.cloaked) continue;
        const dist = distance(ship, other);
        if (dist > weapon.optimal + weapon.falloff) continue;
        const trans = other.transversal || "low";
        const quality = dist <= weapon.optimal ? (trans === "high" ? 1 : 2) : trans === "low" ? 1 : 0;
        options.push({ index, targetId: other.id, quality, dist });
      }
    });
    options.sort((a, b) => b.quality - a.quality || a.dist - b.dist);
    if (!options.length) continue;
    const first = options[0];
    const attack = { shipId: ship.id, weaponIndex: first.index, targetId: first.targetId };
    if (ship.modules.includes("rapid")) {
      const second = options.find((o) => o.index !== first.index);
      if (second) {
        attack.followIndex = second.index;
        attack.followTargetId = second.targetId;
      }
    }
    attacks.push(attack);
  }
  return attacks;
}

export function arenaKeys(game) {
  return boardSet(game.hexes || []);
}

export function previewPath(game, ship, order) {
  const board = arenaKeys(game);
  const stats = statLine(ship, game.ships);
  const color = colorById(order.color);
  const facing = facingAfter(ship.facing, order, stats.agility);
  const target = (game.ships || []).find((s) => s.id === order.focusId) || null;
  const dist = order.card === "hold" ? 0 : Math.min(color?.dist || 0, travelLimit(stats.speed, {
    overdrive: order.overdrive,
    webbed: ship.webbed,
    energy: ship.energy,
    odCooldown: ship.odCooldown,
  }));
  return planPath({
    from: ship,
    facing,
    card: order.card,
    dist,
    target,
    board,
  });
}

export function facingAfter(facing, order, agility) {
  const turn = Math.max(0, Math.min(agility, Number(order.turn) || 0));
  if (!turn || order.turnDir === "none") return ((facing % 6) + 6) % 6;
  const sign = order.turnDir === "right" ? 1 : -1;
  return (facing + sign * turn + 60) % 6;
}

export function catalogName(id) {
  return CATALOG[id]?.name || id;
}

export function shipKey(ship) {
  return key(ship.q, ship.r);
}
