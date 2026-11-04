import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game.js";
import { distance } from "../shared/hex.js";

function match() {
  const game = Game.fromLobby(
    [
      { id: "p1", name: "Rook", isSpectator: false, socketId: "a" },
      { id: "p2", name: "Vex", isSpectator: false, socketId: "b" },
    ],
    "ROOM"
  );
  game.hostId = "p1";
  return game;
}

function rifters(modules) {
  return [0, 1, 2].map(() => ({ hull: "rifter", modules }));
}

function lockFleets(game, a, b) {
  assert.equal(game.submitFleet("p1", a).ok, true);
  assert.equal(game.submitFleet("p2", b).ok, true);
  assert.equal(game.phase, "orders");
}

function park(game, keep) {
  const west = [[-4, 1], [-4, 0], [-4, -1]];
  const east = [[4, 1], [4, 0], [4, -1]];
  const cursor = { p1: 0, p2: 0 };
  for (const ship of game.ships) {
    if (keep.includes(ship)) continue;
    const side = ship.playerId === "p1" ? west : east;
    const [q, r] = side[cursor[ship.playerId]++];
    ship.q = q;
    ship.r = r;
  }
}

function drain(game) {
  let guard = 0;
  while (game.phase === "attack" && guard < 16) {
    const ship = game.shipById(game.activationShipId);
    if (!ship) break;
    const res = game.submitAttacks(ship.playerId, { pass: true });
    assert.equal(res.ok, true, res.error);
    guard += 1;
  }
}

function orders(ships, patch) {
  return ships.map((ship, i) => ({
    shipId: ship.id,
    turn: 0,
    turnDir: "none",
    card: "hold",
    holdSpend: ["approach", "keep", "strafeLeft"][i],
    color: "lb",
    overdrive: null,
    active: null,
    focusId: null,
    useGyro: false,
    ...patch(ship, i),
  }));
}

describe("skirmish flow", () => {
  it("deploys three ships each and keeps secret orders off the opponent view", () => {
    const game = match();
    lockFleets(game, rifters(["blasters", "nano"]), rifters(["blasters", "nano"]));
    assert.equal(game.ships.length, 6);
    const mine = game.living("p1");
    const res = game.submitOrders("p1", orders(mine, () => ({ card: "hold" })));
    assert.equal(res.ok, true);
    const hidden = game.toJSON("p2");
    assert.equal(hidden.yourOrders, null);
    assert.equal(hidden.players.find((p) => p.id === "p1").ordersReady, true);
    assert.equal(hidden.ships.length, 6);
  });

  it("collides on a shared hex, ignores shields, and denies the wreck a shot", () => {
    const game = match();
    lockFleets(
      game,
      [
        { hull: "rifter", modules: ["blasters", "nano"] },
        { hull: "rifter", modules: ["blasters"] },
        { hull: "rifter", modules: ["rockets"] },
      ],
      [
        { hull: "tempest", modules: ["artillery", "extender"] },
        { hull: "tempest", modules: ["rails"] },
        { hull: "tempest", modules: ["rockets"] },
      ]
    );
    const small = game.ships.find((s) => s.playerId === "p1");
    const big = game.ships.find((s) => s.playerId === "p2");
    small.q = 0;
    small.r = 0;
    small.facing = 0;
    big.q = 3;
    big.r = 0;
    big.facing = 3;
    park(game, [small, big]);
    const a = game.submitOrders(
      "p1",
      orders(game.living("p1"), (ship) =>
        ship.id === small.id
          ? { card: "approach", color: "lb", focusId: big.id, holdSpend: null }
          : { card: "hold" }
      )
    );
    const b = game.submitOrders(
      "p2",
      orders(game.living("p2"), (ship) =>
        ship.id === big.id
          ? { card: "approach", color: "lb", focusId: small.id, holdSpend: null }
          : { card: "hold" }
      )
    );
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true, b.error);
    assert.equal(small.removed, true);
    assert.equal(small.collisionKilled, true);
    assert.equal(small.hullHp, 0);
    assert.equal(big.shield, big.shieldMax);
    assert.equal(big.hullHp, big.hullMax - 1);
    assert.equal(game.events.some((e) => e.type === "attack" && e.shipId === small.id), false);
  });

  it("restores a holding ship only after it survives the round", () => {
    const game = match();
    lockFleets(game, rifters(["nano"]), rifters(["nano"]));
    const dropper = game.living("p1")[0];
    dropper.energy = 0;
    dropper.shield = 0;
    park(game, [dropper]);
    const first = game.submitOrders("p1", orders(game.living("p1"), () => ({ card: "hold" })));
    const second = game.submitOrders("p2", orders(game.living("p2"), () => ({ card: "hold" })));
    assert.equal(first.ok, true, first.error);
    assert.equal(second.ok, true, second.error);
    assert.equal(dropper.energy, dropper.energyMax);
    assert.equal(dropper.shield, 1);
  });

  it("drops a smart bomb behind the ship and detonates it after attacks", () => {
    const game = match();
    lockFleets(game, rifters(["bomb", "nano"]), rifters(["nano"]));
    const dropper = game.living("p1")[0];
    const visitor = game.living("p2")[0];
    dropper.q = 0;
    dropper.r = 0;
    dropper.facing = 0;
    visitor.q = -1;
    visitor.r = 0;
    park(game, [dropper, visitor]);
    const first = game.submitOrders(
      "p1",
      orders(game.living("p1"), (ship) =>
        ship.id === dropper.id ? { card: "approach", color: "lb", active: { id: "bomb" }, holdSpend: null } : { card: "hold" }
      )
    );
    const second = game.submitOrders("p2", orders(game.living("p2"), () => ({ card: "hold" })));
    assert.equal(first.ok, true, first.error);
    assert.equal(second.ok, true, second.error);
    drain(game);
    assert.equal(game.bombs.length, 0);
    assert.ok(visitor.shield < visitor.shieldMax || visitor.armor < visitor.armorMax || visitor.hullHp < visitor.hullMax);
    assert.equal(dropper.hullHp, dropper.hullMax);
  });

  it("webs the next turn and blocks movement overdrive", () => {
    const game = match();
    lockFleets(game, rifters(["blasters", "nano"]), rifters(["web", "blasters"]));
    const target = game.living("p1")[0];
    const webber = game.living("p2")[0];
    target.q = 0;
    target.r = 0;
    target.facing = 0;
    webber.q = 2;
    webber.r = 1;
    webber.facing = 0;
    park(game, [target, webber]);
    assert.ok(distance(target, webber) <= 5);
    const a = game.submitOrders("p1", orders(game.living("p1"), () => ({ card: "hold" })));
    const b = game.submitOrders(
      "p2",
      orders(game.living("p2"), (ship) =>
        ship.id === webber.id ? { card: "keep", color: "lb", active: { id: "web", targetId: target.id }, holdSpend: null } : { card: "hold" }
      )
    );
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true, b.error);
    drain(game);
    assert.equal(target.webbed, true);
    const fast = game.submitOrders(
      "p1",
      orders(game.living("p1"), (ship) =>
        ship.id === target.id
          ? { card: "approach", color: "y", overdrive: "movement", focusId: webber.id }
          : { card: "hold" }
      )
    );
    assert.equal(fast.ok, false);
    assert.match(fast.error, /cannot play|webbed/i);
  });

  it("does not let a cloaked ship be targeted", () => {
    const game = match();
    lockFleets(
      game,
      [{ hull: "rifter", modules: ["stealth", "nano"] }, { hull: "rifter", modules: ["blasters"] }, { hull: "rifter", modules: ["rockets"] }],
      rifters(["blasters"])
    );
    const ninja = game.ships.find((s) => s.modules.includes("stealth"));
    const gunner = game.living("p1").find((s) => s.modules.includes("blasters"));
    const foe = game.living("p2")[0];
    ninja.q = 0;
    ninja.r = 0;
    ninja.facing = 0;
    gunner.q = 4;
    gunner.r = 0;
    gunner.facing = 0;
    foe.q = 3;
    foe.r = 0;
    park(game, [ninja, gunner, foe]);
    const a = game.submitOrders(
      "p1",
      orders(game.living("p1"), (ship) => {
        if (ship.id === ninja.id) return { card: "approach", color: "lb", active: { id: "stealth" }, holdSpend: null };
        if (ship.id === gunner.id) return { card: "approach", color: "lb", holdSpend: null };
        return { card: "hold" };
      })
    );
    const b = game.submitOrders("p2", orders(game.living("p2"), () => ({ card: "hold" })));
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true, b.error);
    assert.equal(game.phase, "attack");
    const legal = game.legalTargets(foe).map((t) => t.id);
    assert.equal(legal.includes(ninja.id), false);
    const view = game.toJSON("p2");
    const hidden = view.ships.find((s) => s.id === ninja.id);
    assert.equal(hidden.maneuver, "cloaked");
    assert.equal(game.toJSON("p1").ships.find((s) => s.id === ninja.id).maneuver, "approach");
  });
});
