import { DIRS, add, distance, key, neighbors } from "../shared/hex.js";
import { CATALOG, PILOT_COLORS, SHIPS, colorById, sizeRank } from "../shared/catalog.js";
import { suggestAttacks, suggestOrders } from "../shared/ai.js";
import { uid } from "../shared/rng.js";
import {
  applyCombatDamage,
  applyHit,
  boardSet,
  buildArena,
  collisionOutcome,
  deploymentSlots,
  dirToward,
  freshOverdrive,
  inWeaponRange,
  knockPath,
  normalizeFit,
  nudgeFacing,
  planPath,
  shieldMaxFor,
  starterFleet,
  statLine,
  travelLimit,
  validateFleet,
  validateOrders,
  weaponAt,
  weaponShot,
} from "../shared/rules.js";

const LOG_CAP = 40;

export class Game {
  constructor({ code, players, seed }) {
    const arena = buildArena();
    this.roomCode = code;
    this.seed = seed;
    this.hostId = null;
    this.status = "playing";
    this.phase = "fleet";
    this.round = 1;
    this.serial = 1;
    this.hexes = arena.hexes;
    this.foundations = arena.foundations;
    this.board = boardSet(arena.hexes);
    this.players = players;
    this.ships = [];
    this.bombs = [];
    this.log = ["Fit three ships. Lock the fleet when you are ready."];
    this.events = [];
    this.activations = [];
    this.activationIndex = 0;
    this.activationShipId = null;
    this.winnerId = null;
    this.draw = false;
  }

  static fromLobby(lobby, seed) {
    const pilots = lobby.filter((p) => !p.isSpectator);
    const players = lobby.map((p, i) => ({
      id: p.id,
      name: p.name,
      isSpectator: !!p.isSpectator,
      isBot: !!p.isBot,
      connected: p.isBot || !!p.socketId,
      color: PILOT_COLORS[i % PILOT_COLORS.length],
      fleetReady: !!p.isSpectator,
      ordersReady: false,
      attacksReady: false,
      fleet: null,
      orders: null,
      eliminated: !!p.isSpectator,
    }));
    const game = new Game({ code: String(seed).split(":")[0], players, seed });
    game.pilotCount = pilots.length;
    return game;
  }

  playerById(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  shipById(id) {
    return this.ships.find((s) => s.id === id) || null;
  }

  living(playerId) {
    return this.ships.filter((s) => s.playerId === playerId && !s.removed && s.hullHp > 0);
  }

  bump(phase) {
    this.phase = phase;
    this.serial += 1;
  }

  note(text) {
    this.log.push(text);
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP);
  }

  needsAction(playerId) {
    const player = this.playerById(playerId);
    if (!player || player.isSpectator || this.status !== "playing") return false;
    if (this.phase === "fleet") return !player.fleetReady;
    if (this.phase === "orders") return !player.ordersReady && this.living(playerId).length > 0;
    if (this.phase === "attack") {
      const ship = this.shipById(this.activationShipId);
      return !!ship && ship.playerId === playerId;
    }
    return false;
  }

  submitFleet(playerId, list) {
    if (this.phase !== "fleet") return fail("Fleets are already locked.");
    const player = this.playerById(playerId);
    if (!player || player.isSpectator) return fail("Spectators do not bring a fleet.");
    const error = validateFleet(list);
    if (error) return fail(error);
    player.fleet = list.map((s) => normalizeFit(s));
    player.fleetReady = true;
    this.note(`${player.name} locked a fleet.`);
    if (this.players.filter((p) => !p.isSpectator).every((p) => p.fleetReady)) this.deploy();
    return { ok: true };
  }

  deploy() {
    const pilots = this.players.filter((p) => !p.isSpectator);
    const slots = deploymentSlots(pilots.length, this.board, this.foundations);
    this.ships = [];
    pilots.forEach((player, index) => {
      const spots = slots[index] || [];
      player.fleet.forEach((fit, n) => {
        const fitted = normalizeFit(fit);
        const def = SHIPS[fitted.hull];
        const spot = spots[n] || spots[0];
        const counts = {};
        const same = player.fleet.filter((s) => s.hull === fit.hull).length;
        counts[fit.hull] = (this.ships.filter((s) => s.playerId === player.id && s.hull === fit.hull).length) + 1;
        const ship = {
          id: `${player.id}:s${n}`,
          playerId: player.id,
          name: same > 1 ? `${def.name} ${counts[fit.hull]}` : def.name,
          hull: fitted.hull,
          modules: fitted.modules,
          ammo: fitted.ammo,
          q: spot.q,
          r: spot.r,
          facing: spot.facing,
          shield: def.shield,
          armor: def.armor,
          armorMax: def.armor,
          hullHp: def.hull,
          hullMax: def.hull,
          energy: def.energy,
          energyMax: def.energy,
          spent: {},
          webbed: false,
          webNext: false,
          odCool: freshOverdrive(),
          cloaked: false,
          overcharge: false,
          removed: false,
          collisionKilled: false,
          pendingBombDeath: false,
          transversal: "low",
          maneuver: null,
          tookDamage: false,
          gyroUsed: false,
          useGyro: true,
          pending: null,
          held: false,
          pendingMove: null,
          stealthOrder: null,
        };
        this.ships.push(ship);
      });
    });
    for (const ship of this.ships) {
      ship.shieldMax = shieldMaxFor(ship, this.ships);
      ship.shield = ship.shieldMax;
    }
    this.note("Fleets on the grid. Plot secret orders.");
    for (const player of this.players) {
      if (!player.isSpectator) {
        player.ordersReady = false;
        player.orders = null;
        player.attacksReady = false;
      }
    }
    this.bump("orders");
  }

  submitOrders(playerId, orders) {
    if (this.phase !== "orders") return fail("Orders are closed.");
    const player = this.playerById(playerId);
    if (!player || player.isSpectator) return fail("You are not flying.");
    if (player.ordersReady) return fail("Orders already locked.");
    const mine = this.living(playerId);
    const error = validateOrders(mine, orders, this.ships);
    if (error) return fail(error);
    for (const order of orders) {
      if (order.focusId) {
        const focus = this.shipById(order.focusId);
        if (!focus || focus.playerId === playerId || focus.removed) return fail("Focus an enemy ship.");
      }
      if (order.active?.targetId) {
        const target = this.shipById(order.active.targetId);
        if (!target || target.playerId === playerId || target.removed || target.hullHp <= 0) {
          return fail("That module needs a living enemy.");
        }
      }
    }
    player.orders = orders.map((o) => ({ ...o, active: o.active ? { ...o.active } : null }));
    player.ordersReady = true;
    this.note(`${player.name} locked orders.`);
    const pending = this.players.filter((p) => !p.isSpectator && !p.eliminated && this.living(p.id).length);
    if (pending.every((p) => p.ordersReady)) this.resolveOrders();
    return { ok: true };
  }

  resolveOrders() {
    this.events = [];
    const starts = new Map(this.ships.map((s) => [s.id, { q: s.q, r: s.r, facing: s.facing }]));
    for (const ship of this.ships) {
      ship.tookDamage = false;
      ship.gyroUsed = false;
      ship.collisionKilled = false;
      ship.pendingBombDeath = false;
      ship.overcharge = false;
      ship.cloaked = false;
      ship.pending = null;
      ship.odWeapons = false;
      ship.held = false;
      ship.stealthOrder = null;
      ship.anim = null;
    }

    for (const player of this.players) {
      if (!player.orders) continue;
      for (const order of player.orders) {
        const ship = this.shipById(order.shipId);
        if (!ship || ship.removed || ship.hullHp <= 0) continue;
        const stats = statLine(ship, this.ships);
        this.applyOrderPrep(ship, order, stats);
      }
    }

    for (const player of this.players) {
      if (!player.orders) continue;
      for (const order of player.orders) {
        const ship = this.shipById(order.shipId);
        if (!ship || ship.removed || ship.hullHp <= 0) continue;
        if (ship.held) {
          this.stay(ship, "hold", false);
          continue;
        }
        if (ship.pendingMove) this.fly(ship, ship.pendingMove, true);
        ship.pendingMove = null;
        if (ship.stealthOrder) {
          const plotted = ship.stealthOrder;
          ship.stealthOrder = null;
          ship.pendingMove = plotted;
          ship.cloaked = true;
          if (!ship.anim) this.stay(ship, plotted.card, true);
          continue;
        }
        this.fly(ship, order, false);
      }
    }

    this.clipCrossings();
    this.resolveCollisions(starts);
    this.applyGyro();
    this.resolveActives();
    this.applyGyro();

    for (const player of this.players) {
      player.orders = null;
      player.ordersReady = false;
      player.attacksReady = false;
    }
    this.beginAttack();
  }

  stay(ship, card, cloaked) {
    ship.maneuver = card;
    ship.transversal = "low";
    ship.anim = [{ q: ship.q, r: ship.r }];
    this.events.push({
      type: "move",
      shipId: ship.id,
      ownerId: ship.playerId,
      path: ship.anim.map((h) => ({ q: h.q, r: h.r })),
      facing: ship.facing,
      endFacing: ship.facing,
      color: null,
      cloaked,
      card: cloaked ? "cloaked" : card,
    });
  }

  fly(ship, order, stored) {
    const stats = statLine(ship, this.ships);
    const turn = Math.max(0, Math.min(stats.agility, Number(order.turn) || 0));
    if (stored && turn > 0 && order.turnDir !== "none") {
      const sign = order.turnDir === "right" ? -1 : 1;
      ship.facing = (ship.facing + sign * turn + 60) % 6;
    }
    const color = colorById(order.color);
    let dist = order.dist;
    if (dist == null) {
      const limit = travelLimit(stats.speed, {
        overdrive: order.overdrive,
        webbed: ship.webbed,
        energy: ship.energy + (order.overdrive ? 1 : 0),
        odCooldown: false,
      });
      dist = Math.min(color?.dist || 0, limit);
    }
    const nose = ship.facing;
    const planned = planPath({
      from: { q: ship.q, r: ship.r },
      facing: nose,
      card: order.card,
      color: color?.id || order.color,
      dist,
      board: this.board,
    });
    const steps = planned.path.map((h) => ({ q: h.q, r: h.r }));
    ship.anim = ship.anim ? [...ship.anim, ...steps.slice(1)] : steps;
    const end = steps[steps.length - 1];
    ship.q = end.q;
    ship.r = end.r;
    ship.facing = planned.facing;
    ship.transversal = planned.transversal;
    ship.maneuver = order.card;
    const existing = this.events.find((e) => e.type === "move" && e.shipId === ship.id);
    if (existing) {
      existing.path = ship.anim.map((h) => ({ q: h.q, r: h.r }));
      existing.endFacing = ship.facing;
      existing.card = order.card;
      existing.cloaked = false;
    } else {
      this.events.push({
        type: "move",
        shipId: ship.id,
        ownerId: ship.playerId,
        path: ship.anim.map((h) => ({ q: h.q, r: h.r })),
        facing: nose,
        endFacing: ship.facing,
        color: color?.id || order.color || null,
        cloaked: false,
        card: order.card,
      });
    }
  }

  clipCrossings() {
    const movers = this.ships.filter((s) => s.anim && s.anim.length > 1 && !s.removed);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < movers.length; i++) {
        for (let j = i + 1; j < movers.length; j++) {
          const hit = sharedStep(movers[i].anim, movers[j].anim);
          if (!hit) continue;
          if (movers[i].anim.length - 1 <= hit.a && movers[j].anim.length - 1 <= hit.b && key(movers[i].q, movers[i].r) === key(movers[j].q, movers[j].r)) continue;
          movers[i].anim = movers[i].anim.slice(0, hit.a + 1);
          movers[j].anim = movers[j].anim.slice(0, hit.b + 1);
          const pile = { q: hit.hex.q, r: hit.hex.r };
          movers[i].anim[movers[i].anim.length - 1] = pile;
          movers[j].anim[movers[j].anim.length - 1] = { ...pile };
          movers[i].q = pile.q;
          movers[i].r = pile.r;
          movers[j].q = pile.q;
          movers[j].r = pile.r;
          for (const ship of [movers[i], movers[j]]) {
            const move = this.events.find((e) => e.type === "move" && e.shipId === ship.id);
            if (move) move.path = ship.anim.map((h) => ({ q: h.q, r: h.r }));
          }
          changed = true;
        }
      }
    }
  }

  beginAttack() {
    const pilots = this.players.filter((p) => !p.isSpectator && !p.eliminated);
    const lanes = pilots.map((p) => this.ships.filter((s) => s.playerId === p.id && this.canFire(s)));
    this.activations = [];
    const max = Math.max(0, ...lanes.map((lane) => lane.length));
    for (let i = 0; i < max; i++) {
      for (const lane of lanes) if (lane[i]) this.activations.push(lane[i].id);
    }
    this.activationIndex = 0;
    this.advanceActivation();
  }

  advanceActivation() {
    while (this.activationIndex < this.activations.length) {
      const ship = this.shipById(this.activations[this.activationIndex]);
      if (ship && this.canFire(ship) && this.legalTargets(ship).length) {
        this.activationShipId = ship.id;
        this.note(`${ship.name} may fire.`);
        this.bump("attack");
        return;
      }
      this.activationIndex += 1;
    }
    this.activationShipId = null;
    this.openOrders();
  }

  applyOrderPrep(ship, order, stats) {
    ship.useGyro = order.useGyro !== false;
    if (order.card === "hold") {
      ship.held = true;
      this.note(`${ship.name} holds and must survive the shooting.`);
      return;
    }
    const turn = Math.max(0, Math.min(stats.agility, Number(order.turn) || 0));
    if (!ship.odCool) ship.odCool = freshOverdrive();
    if (order.overdrive) {
      ship.energy = Math.max(0, ship.energy - 1);
      ship.odWeapons = order.overdrive === "weapons";
      ship.odCool[order.overdrive] = true;
      if (order.overdrive === "shield") {
        ship.shield = Math.min(stats.shieldMax, ship.shield + 1);
        this.note(`${ship.name} overdrives shields.`);
      }
      if (ship.odWeapons && ship.modules.includes("overcharge")) ship.overcharge = true;
    }
    if (order.active?.id === "stealth") {
      const color = colorById(order.color);
      const limit = travelLimit(stats.speed, {
        overdrive: order.overdrive,
        webbed: ship.webbed,
        energy: ship.energy + (order.overdrive ? 1 : 0),
        odCooldown: false,
      });
      ship.stealthOrder = {
        card: order.card,
        color: order.color,
        turn,
        turnDir: order.turnDir,
        dist: Math.min(color?.dist || 0, limit),
      };
      ship.cloaked = true;
      ship.spent = { ...ship.spent, stealth: true };
      this.note(`${ship.name} drops off the scope.`);
      return;
    }
    if (turn > 0 && order.turnDir !== "none") {
      const sign = order.turnDir === "right" ? -1 : 1;
      ship.facing = (ship.facing + sign * turn + 60) % 6;
    }
    if (order.active?.id === "bomb") {
      const back = (ship.facing + 3) % 6;
      const hex = add(ship, DIRS[back]);
      if (this.board.has(key(hex.q, hex.r))) {
        this.bombs.push({
          id: uid("bomb"),
          ownerShipId: ship.id,
          ownerPlayerId: ship.playerId,
          ownerName: ship.name,
          q: hex.q,
          r: hex.r,
          placedRound: this.round,
        });
        ship.spent = { ...ship.spent, bomb: true };
        this.note(`${ship.name} drops a smart bomb behind the ship.`);
      }
    }
    if (order.active && (order.active.id === "neut" || order.active.id === "web")) {
      ship.pending = { id: order.active.id, targetId: order.active.targetId };
    }
  }

  resolveCollisions(starts) {
    const active = () => this.ships.filter((s) => !s.removed && s.hullHp > 0);
    const pairs = [];
    const list = active();
    const groups = new Map();
    for (const ship of list) {
      const k = key(ship.q, ship.r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(ship);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) pairs.push([group[i], group[j], "ram"]);
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const as = starts.get(a.id);
        const bs = starts.get(b.id);
        const swapped = a.q === bs.q && a.r === bs.r && b.q === as.q && b.r === as.r;
        const moved = (a.q !== as.q || a.r !== as.r) && (b.q !== bs.q || b.r !== bs.r);
        const same = a.q === b.q && a.r === b.r;
        if (swapped && moved && !same) pairs.push([a, b, "swap"]);
      }
    }
    if (!pairs.length) return;

    const knock = new Map();
    for (const [a, b] of pairs) {
      const ao = collisionOutcome(a.modules, sizeRank(SHIPS[a.hull].size), b.modules, sizeRank(SHIPS[b.hull].size));
      const bo = collisionOutcome(b.modules, sizeRank(SHIPS[b.hull].size), a.modules, sizeRank(SHIPS[a.hull].size));
      const ha = applyCombatDamage(a, ao.damage, { hullOnly: true });
      const hb = applyCombatDamage(b, bo.damage, { hullOnly: true });
      this.note(`${a.name} and ${b.name} collide. Hull ${ha.hull} / ${hb.hull}.`);
      const dirA = awayDir(a, b, starts.get(a.id));
      const dirB = awayDir(b, a, starts.get(b.id));
      knock.set(a.id, { steps: (knock.get(a.id)?.steps || 0) + ao.knock, dir: dirA });
      knock.set(b.id, { steps: (knock.get(b.id)?.steps || 0) + bo.knock, dir: dirB });
      this.events.push({
        type: "collide",
        a: a.id,
        b: b.id,
        dmgA: ha.hull,
        dmgB: hb.hull,
      });
    }

    for (const ship of this.ships) {
      if (ship.removed || ship.hullHp > 0) continue;
      ship.collisionKilled = true;
      ship.removed = true;
      this.note(`${ship.name} is destroyed in the collision and does not fire.`);
      this.events.push({ type: "wreck", shipId: ship.id, reason: "collision" });
    }
    const reserved = new Set(active().map((s) => key(s.q, s.r)));
    for (const ship of active()) {
      const push = knock.get(ship.id);
      if (!push?.steps) {
        ship.facing = nudgeFacing(ship.facing, push?.dir ?? ship.facing);
        continue;
      }
      reserved.delete(key(ship.q, ship.r));
      const extra = knockPath(ship, push.dir, push.steps, this.board, reserved);
      if (extra.length) {
        const end = extra[extra.length - 1];
        ship.q = end.q;
        ship.r = end.r;
        ship.anim = [...(ship.anim || []), ...extra];
        const move = this.events.find((e) => e.type === "move" && e.shipId === ship.id);
        if (move) move.path = ship.anim.map((h) => ({ q: h.q, r: h.r }));
      }
      reserved.add(key(ship.q, ship.r));
      ship.facing = nudgeFacing(ship.facing, push.dir);
    }
  }

  applyGyro() {
    for (const ship of this.ships) {
      if (ship.removed || ship.gyroUsed || !ship.tookDamage || ship.hullHp <= 0) continue;
      if (!ship.modules.includes("gyro") || ship.useGyro === false) continue;
      const blocked = new Set(
        this.ships.filter((s) => !s.removed && s.id !== ship.id && s.hullHp > 0).map((s) => key(s.q, s.r))
      );
      const enemies = this.ships.filter((s) => s.playerId !== ship.playerId && !s.removed && s.hullHp > 0);
      let best = null;
      let bestD = -1;
      for (const n of neighbors(ship)) {
        const k = key(n.q, n.r);
        if (!this.board.has(k) || blocked.has(k)) continue;
        const d = enemies.length ? Math.min(...enemies.map((e) => distance(n, e))) : 1;
        if (d > bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) continue;
      ship.q = best.q;
      ship.r = best.r;
      ship.gyroUsed = true;
      ship.anim = [...(ship.anim || [{ q: ship.q, r: ship.r }]), { q: best.q, r: best.r }];
      this.events.push({ type: "gyro", shipId: ship.id, q: best.q, r: best.r });
      this.note(`${ship.name} gyros one hex.`);
    }
  }

  resolveActives() {
    for (const ship of this.ships) {
      if (!ship.pending || ship.removed) continue;
      const target = this.shipById(ship.pending.targetId);
      const spec = CATALOG[ship.pending.id];
      const reach = spec?.range ?? 5;
      if (!target || target.removed || target.hullHp <= 0 || distance(ship, target) > reach) {
        this.note(`${ship.name}'s ${spec?.name || "module"} fizzles.`);
        ship.pending = null;
        continue;
      }
      if (ship.pending.id === "neut") {
        target.energy = Math.max(0, target.energy - 1);
        ship.spent = { ...ship.spent, neut: true };
        this.note(`${ship.name} neutralizes ${target.name}.`);
      } else if (ship.pending.id === "web") {
        target.webNext = true;
        ship.spent = { ...ship.spent, web: true };
        this.note(`${ship.name} webs ${target.name}.`);
      }
      ship.pending = null;
    }
  }

  explodeBombs() {
    for (const bomb of this.bombs) {
      const hits = [];
      for (const ship of this.ships) {
        if (ship.removed || ship.hullHp <= 0) continue;
        const dist = distance(ship, bomb);
        const amount = dist <= 1 ? 5 : dist === 2 ? 2 : 0;
        if (!amount) continue;
        const hit = applyHit(ship, amount, { ammo: "explosive" });
        hits.push({ shipId: ship.id, damage: hit.dealt, shield: hit.shield, armor: hit.armor, hull: hit.hull });
        if (hit.knock && ship.hullHp > 0) this.shove(ship, dirToward(bomb, ship), hit.knock);
        this.note(`${bomb.ownerName}'s smart bomb hits ${ship.name} for ${hit.dealt}.`);
      }
      this.events.push({ type: "bomb", q: bomb.q, r: bomb.r, hits });
    }
    this.bombs = [];
  }

  canFire(ship) {
    if (!ship || ship.removed || ship.collisionKilled || ship.held) return false;
    if (ship.hullHp <= 0) return false;
    return ship.modules.some((id) => CATALOG[id]?.slot === "weapon");
  }

  legalTargets(ship) {
    const out = [];
    for (const other of this.ships) {
      if (other.playerId === ship.playerId || other.removed || other.collisionKilled || other.hullHp <= 0) continue;
      if (other.cloaked) continue;
      const dist = distance(ship, other);
      const weapons = [];
      ship.modules.forEach((id, index) => {
        const weapon = weaponAt(ship, index);
        if (weapon && inWeaponRange(weapon, dist)) weapons.push(index);
      });
      if (weapons.length) out.push({ id: other.id, dist, weapons });
    }
    return out;
  }

  submitAttacks(playerId, attacks) {
    if (this.phase !== "attack") return fail("Not the attack phase.");
    const player = this.playerById(playerId);
    if (!player || player.isSpectator) return fail("You are not flying.");
    const ship = this.shipById(this.activationShipId);
    if (!ship || ship.playerId !== playerId) return fail("Not your activation.");
    const attack = Array.isArray(attacks) ? attacks.find((a) => a?.shipId === ship.id) || attacks[0] : attacks;
    if (!attack || attack.pass) {
      this.note(`${ship.name} holds fire.`);
      this.activationIndex += 1;
      this.advanceActivation();
      return { ok: true };
    }
    const legal = this.legalTargets(ship);
    const weapon = weaponAt(ship, attack.weaponIndex);
    const target = legal.find((t) => t.id === attack.targetId);
    if (!weapon || !target || !target.weapons.includes(attack.weaponIndex)) {
      return fail(`${ship.name} cannot fire that shot.`);
    }
    const first = this.resolveShot(ship, attack.weaponIndex, attack.targetId, false);
    if (attack.followIndex != null && ship.modules.includes("rapid") && first?.quality === "red") {
      const followTarget = this.legalTargets(ship).find((t) => t.id === (attack.followTargetId || attack.targetId));
      if (followTarget?.weapons.includes(attack.followIndex) && attack.followIndex !== attack.weaponIndex) {
        this.resolveShot(ship, attack.followIndex, followTarget.id, true);
      }
    }
    this.activationIndex += 1;
    this.advanceActivation();
    return { ok: true };
  }

  resolveShot(ship, weaponIndex, targetId, follow) {
    const shot = this.previewShot(ship, weaponIndex, targetId, follow);
    if (!shot) return null;
    const target = this.shipById(targetId);
    const applied = shot.quality === "miss" || !target
      ? { dealt: 0, knock: 0 }
      : applyHit(target, shot.damage, { ammo: shot.ammo });
    this.events.push({ ...shot, damage: applied.dealt, knock: applied.knock });
    const word = shot.quality === "miss" ? "misses" : `hits ${shot.quality} for ${applied.dealt}`;
    this.note(`${shot.shipName} ${shot.weapon} ${word} ${shot.targetName}.`);
    if (applied.knock && target && target.hullHp > 0) this.shove(target, dirToward(ship, target), applied.knock);
    this.applyGyro();
    return { ...shot, damage: applied.dealt };
  }

  shove(target, dir, steps) {
    const reserved = new Set(
      this.ships.filter((s) => !s.removed && s.hullHp > 0 && s.id !== target.id).map((s) => key(s.q, s.r))
    );
    const extra = knockPath(target, dir, steps, this.board, reserved);
    if (!extra.length) return;
    const end = extra[extra.length - 1];
    target.q = end.q;
    target.r = end.r;
    this.events.push({ type: "knock", shipId: target.id, q: end.q, r: end.r });
    this.note(`${target.name} is knocked back.`);
  }

  previewShot(ship, weaponIndex, targetId, follow) {
    const weapon = weaponAt(ship, weaponIndex);
    const target = this.shipById(targetId);
    if (!weapon || !target || target.removed || target.cloaked || target.hullHp <= 0) return null;
    const dist = distance(ship, target);
    const shot = weaponShot(weapon, dist, {
      overdrive: !!ship.odWeapons,
      overcharge: !!ship.overcharge,
    });
    return {
      type: "attack",
      shipId: ship.id,
      shipName: ship.name,
      targetId: target.id,
      targetName: target.name,
      quality: shot.quality,
      damage: shot.damage,
      knock: 0,
      ammo: weapon.ammo,
      weapon: weapon.name,
      follow,
    };
  }

  openOrders() {
    this.explodeBombs();
    this.applyGyro();
    for (const ship of this.ships) {
      if (ship.hullHp <= 0) {
        ship.removed = true;
        ship.held = false;
        if (!ship.collisionKilled) {
          this.note(`${ship.name} breaks apart.`);
          this.events.push({ type: "wreck", shipId: ship.id, reason: "hull" });
        }
      }
    }
    for (const ship of this.ships) {
      if (ship.removed || !ship.held) continue;
      const stats = statLine(ship, this.ships);
      ship.energy = stats.energyMax;
      ship.shield = Math.min(stats.shieldMax, ship.shield + 1);
      if (ship.modules.includes("repair")) ship.armor = Math.min(ship.armorMax, (ship.armor || 0) + 1);
      ship.spent = {};
      ship.odCool = freshOverdrive();
      this.note(`${ship.name} recovers. Energy full, shield patched, systems reset.`);
    }
    for (const ship of this.ships) {
      if (ship.removed) continue;
      ship.held = false;
      ship.shieldMax = shieldMaxFor(ship, this.ships);
      ship.shield = Math.min(ship.shield, ship.shieldMax);
      ship.webbed = !!ship.webNext;
      ship.webNext = false;
      ship.cloaked = false;
      ship.overcharge = false;
      ship.pending = null;
      ship.tookDamage = false;
    }
    const alive = this.players.filter((p) => !p.isSpectator && this.ships.some((s) => s.playerId === p.id && !s.removed));
    for (const player of this.players) {
      if (player.isSpectator) continue;
      player.eliminated = !alive.includes(player);
      player.ordersReady = false;
      player.orders = null;
      player.attacksReady = false;
    }
    if (alive.length <= 1) {
      this.status = "done";
      this.winnerId = alive[0]?.id || null;
      this.draw = alive.length === 0;
      this.bump("done");
      this.note(this.draw ? "Both fleets are gone." : `${alive[0].name} holds the field.`);
      return;
    }
    this.round += 1;
    this.note(`Round ${this.round}. Plot secret orders.`);
    this.bump("orders");
  }

  forceAction(playerId) {
    if (!this.needsAction(playerId)) return { ok: true };
    if (this.phase === "fleet") return this.submitFleet(playerId, starterFleet());
    if (this.phase === "orders") {
      const orders = suggestOrders(this, playerId);
      const error = validateOrders(this.living(playerId), orders, this.ships);
      if (error) return this.submitOrders(playerId, holdAll(this.living(playerId)));
      return this.submitOrders(playerId, orders);
    }
    if (this.phase === "attack") return this.submitAttacks(playerId, suggestAttacks(this, playerId));
    return { ok: true };
  }

  eventsFor(viewerId) {
    return this.events.map((ev) => {
      if (ev.type !== "move" || !ev.cloaked || ev.ownerId === viewerId) return ev;
      const end = ev.path[ev.path.length - 1];
      return { ...ev, path: end ? [end] : [], card: "cloaked", color: null };
    });
  }

  toJSON(viewerId) {
    const viewer = this.playerById(viewerId);
    return {
      status: this.status,
      phase: this.phase,
      round: this.round,
      serial: this.serial,
      roomCode: this.roomCode,
      hostId: this.hostId,
      winnerId: this.winnerId,
      draw: this.draw,
      hexes: this.hexes,
      foundations: this.foundations,
      bombs: this.bombs.map((b) => ({
        id: b.id,
        q: b.q,
        r: b.r,
        ownerName: b.ownerName,
        ownerPlayerId: b.ownerPlayerId,
      })),
      log: this.log.slice(-18),
      yourFleet: viewer?.fleet || null,
      yourOrders: viewer?.orders || null,
      fleetReady: !!viewer?.fleetReady,
      ordersReady: !!viewer?.ordersReady,
      attacksReady: !!viewer?.attacksReady,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isSpectator: p.isSpectator,
        isBot: p.isBot,
        connected: p.connected,
        eliminated: p.eliminated,
        fleetReady: p.fleetReady,
        ordersReady: p.ordersReady,
        attacksReady: p.attacksReady,
      })),
      ships: this.ships.filter((s) => !s.removed).map((s) => this.shipJSON(s, viewerId)),
      activation: this.phase === "attack" && this.activationShipId
        ? {
            shipId: this.activationShipId,
            playerId: this.shipById(this.activationShipId)?.playerId || null,
            name: this.shipById(this.activationShipId)?.name || "",
          }
        : null,
      targets: this.phase === "attack" && viewer && !viewer.isSpectator && this.shipById(this.activationShipId)?.playerId === viewerId
        ? { [this.activationShipId]: this.legalTargets(this.shipById(this.activationShipId)) }
        : {},
    };
  }

  shipJSON(ship, viewerId) {
    const stats = statLine(ship, this.ships);
    const hide = ship.cloaked && ship.playerId !== viewerId;
    return {
      id: ship.id,
      playerId: ship.playerId,
      name: ship.name,
      hull: ship.hull,
      hullName: SHIPS[ship.hull].name,
      size: SHIPS[ship.hull].size,
      modules: ship.modules,
      ammo: ship.ammo || [],
      q: ship.q,
      r: ship.r,
      facing: ship.facing,
      shield: ship.shield,
      shieldMax: stats.shieldMax,
      armor: ship.armor || 0,
      armorMax: ship.armorMax || 0,
      hullHp: ship.hullHp,
      hullMax: ship.hullMax,
      energy: ship.energy,
      energyMax: stats.energyMax,
      speed: stats.speed,
      agility: stats.agility,
      damage: stats.damage,
      webbed: ship.webbed,
      odCool: ship.odCool || freshOverdrive(),
      cloaked: hide,
      webIncoming: ship.webNext,
      transversal: hide ? null : ship.transversal,
      maneuver: hide ? "cloaked" : ship.maneuver,
      spent: ship.playerId === viewerId ? ship.spent : {},
      collisionKilled: ship.collisionKilled,
      pendingBombDeath: ship.pendingBombDeath,
    };
  }
}

function sharedStep(pathA, pathB) {
  const limit = Math.min(pathA.length, pathB.length);
  for (let i = 1; i < limit; i++) {
    const a = key(pathA[i].q, pathA[i].r);
    const b = key(pathB[i].q, pathB[i].r);
    if (a === b) return { a: i, b: i, hex: pathA[i] };
    const prevA = key(pathA[i - 1].q, pathA[i - 1].r);
    const prevB = key(pathB[i - 1].q, pathB[i - 1].r);
    if (a === prevB && b === prevA) return { a: i, b: i, hex: pathA[i] };
  }
  return null;
}

function fail(error) {
  return { ok: false, error };
}

function awayDir(self, other, start) {
  if (self.q !== other.q || self.r !== other.r) return dirToward(other, self);
  if (start && (start.q !== self.q || start.r !== self.r)) return dirToward(self, start);
  return (self.facing + 3) % 6;
}

function holdAll(ships) {
  return ships.map((ship, i) => ({
    shipId: ship.id,
    turn: 0,
    turnDir: "none",
    card: "hold",
    holdSpend: ["approach", "keep", "orbitLeft", "orbitRight", "strafeLeft", "strafeRight"][i % 6],
    color: "lb",
    overdrive: null,
    active: null,
    focusId: null,
    useGyro: true,
  }));
}

export function holdOrders(ships) {
  return holdAll(ships);
}

export { uid };
