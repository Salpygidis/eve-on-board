/** Legal default orders for bots and the suggestion button. */

import { distance, key } from "./hex.js";
import { CATALOG, COLORS, MANEUVERS, colorById } from "./catalog.js";
import {
  boardSet,
  bandAt,
  cardReach,
  isCooling,
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

function bestColor(stats, ship, card, wantHexes) {
  const cooling = isCooling(ship, "movement");
  const limit = travelLimit(stats.speed, {
    overdrive: "movement",
    webbed: ship.webbed,
    energy: ship.energy,
    odCooldown: cooling,
  });
  const plain = travelLimit(stats.speed, {
    webbed: ship.webbed,
    energy: ship.energy,
    odCooldown: cooling,
  });
  const legal = COLORS.filter((color) => color.dist <= limit).map((color) => ({
    id: color.id,
    hexes: cardReach(card, color.id),
    movement: color.dist > plain,
  }));
  if (!legal.length) return { color: "lb", movement: false, hexes: 0 };
  const under = legal.filter((color) => color.hexes <= wantHexes);
  const pool = under.length ? under : legal;
  pool.sort((a, b) => (under.length ? b.hexes - a.hexes : a.hexes - b.hexes));
  return pool[0];
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
    const optimal = weapons.reduce((m, w) => Math.max(m, bestRange(w)), 1);
    const reach = weapons.reduce((m, w) => Math.max(m, maxRange(w)), 0);
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
    const picked = card === "hold" ? { color: "lb", movement: false, hexes: 0 } : bestColor(stats, ship, card, Math.max(want, 1));
    if (card !== "hold" && picked.hexes <= 0) {
      holdSpend = card;
      card = "hold";
    }
    let overdrive = null;
    const canDrive = !isCooling(ship, "movement") && ship.energy >= 1 && !ship.webbed;
    if (card !== "hold" && picked.movement && canDrive) overdrive = "movement";
    else if (card !== "hold" && !isCooling(ship, "weapons") && ship.energy >= 1 && foe && foe.dist <= reach) overdrive = "weapons";
    else if (card !== "hold" && !isCooling(ship, "shield") && ship.energy >= 1 && ship.shield < stats.shieldMax) overdrive = "shield";

    let active = null;
    const spent = ship.spent || {};
    if (card !== "hold" && foe && ship.modules.includes("web") && !spent.web && foe.dist <= 5 && !foe.webbed && !foe.webNext) {
      active = { id: "web", targetId: foe.ship.id };
    } else if (card !== "hold" && foe && ship.modules.includes("neut") && !spent.neut && foe.dist <= 5 && foe.energy > 0) {
      active = { id: "neut", targetId: foe.ship.id };
    } else if (card !== "hold" && foe && ship.modules.includes("bomb") && !spent.bomb && foe.dist <= 2) {
      active = { id: "bomb" };
    } else if (card !== "hold" && ship.modules.includes("stealth") && !spent.stealth && ship.hullHp <= Math.ceil(ship.hullMax / 2)) {
      active = { id: "stealth" };
    }

    let turn = 0;
    let turnDir = "none";
    if (foe && stats.agility > 0) {
      const desiredDir = dirToward(ship, foe.ship);
      const left = (desiredDir - ship.facing + 6) % 6;
      const right = (ship.facing - desiredDir + 6) % 6;
      if (desiredDir !== ship.facing) {
        if (right <= left) {
          turn = Math.min(stats.agility, right);
          turnDir = "right";
        } else {
          turn = Math.min(stats.agility, left);
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
      color: picked.color || picked.id || "lb",
      overdrive,
      active,
      focusId: foe?.ship.id || null,
      useGyro: true,
    };
  });
}

function maxRange(weapon) {
  if (!weapon?.bands) return 0;
  let max = 0;
  weapon.bands.forEach((band, index) => {
    if (band) max = index;
  });
  return max;
}

function bestRange(weapon) {
  if (!weapon?.bands) return 1;
  let best = 1;
  let damage = -1;
  weapon.bands.forEach((band, index) => {
    if (band && band[1] > damage) {
      damage = band[1];
      best = index;
    }
  });
  return best;
}

export function suggestAttacks(game, playerId) {
  const shipId = game.activationShipId || game.activation?.shipId;
  const ship = (game.ships || []).find((s) => s.id === shipId && s.playerId === playerId);
  if (!ship) return { pass: true, shipId };
  const options = [];
  ship.modules.forEach((id, index) => {
    const weapon = weaponAt(ship, index);
    if (!weapon) return;
    for (const other of game.ships) {
      if (other.playerId === ship.playerId || other.removed || other.collisionKilled || other.hullHp <= 0) continue;
      if (other.cloaked) continue;
      const dist = distance(ship, other);
      const band = bandAt(weapon, dist);
      if (!band) continue;
      options.push({ index, targetId: other.id, quality: band[0] === "red" ? 2 : 1, damage: band[1], dist });
    }
  });
  options.sort((a, b) => b.quality - a.quality || b.damage - a.damage || a.dist - b.dist);
  if (!options.length) return { pass: true, shipId: ship.id };
  const first = options[0];
  const attack = { shipId: ship.id, weaponIndex: first.index, targetId: first.targetId };
  if (ship.modules.includes("rapid") && first.quality === 2) {
    const second = options.find((o) => o.index !== first.index);
    if (second) {
      attack.followIndex = second.index;
      attack.followTargetId = second.targetId;
    }
  }
  return attack;
}

export function arenaKeys(game) {
  return boardSet(game.hexes || []);
}

export function previewPath(game, ship, order) {
  const board = arenaKeys(game);
  const stats = statLine(ship, game.ships);
  const color = colorById(order.color);
  const facing = facingAfter(ship.facing, order, stats.agility);
  const dist = order.card === "hold" ? 0 : Math.min(color?.dist || 0, travelLimit(stats.speed, {
    overdrive: order.overdrive,
    webbed: ship.webbed,
    energy: order.card === "hold" ? stats.energyMax : ship.energy,
    odCooldown: order.card === "hold" ? false : isCooling(ship, "movement"),
  }));
  return planPath({
    from: ship,
    facing,
    card: order.card,
    color: order.color,
    dist,
    board,
  });
}

export function facingAfter(facing, order, agility) {
  const turn = Math.max(0, Math.min(agility, Number(order.turn) || 0));
  if (!turn || order.turnDir === "none") return ((facing % 6) + 6) % 6;
  const sign = order.turnDir === "right" ? -1 : 1;
  return (facing + sign * turn + 60) % 6;
}

export function catalogName(id) {
  return CATALOG[id]?.name || id;
}

export function shipKey(ship) {
  return key(ship.q, ship.r);
}
