import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { key, distance, faceStep } from "../shared/hex.js";
import {
  buildArena,
  boardSet,
  collisionOutcome,
  deploymentSlots,
  engagement,
  planPath,
  shotDamage,
  starterFleet,
  travelLimit,
  validateFleet,
} from "../shared/rules.js";

describe("fleet racks", () => {
  it("accepts the sample fleet and rejects an illegal fit", () => {
    assert.equal(validateFleet(starterFleet()), null);
    const heavy = [{ hull: "rifter", modules: ["artillery"] }, starterFleet()[1], starterFleet()[2]];
    assert.match(validateFleet(heavy), /does not fit/);
    const over = [{ hull: "rifter", modules: ["blasters", "nano", "web"] }, starterFleet()[1], starterFleet()[2]];
    assert.match(validateFleet(over), /rack/);
    assert.match(validateFleet([{ hull: "tempest", modules: ["stealth"] }]), /exactly 3/);
  });
});

describe("movement colors", () => {
  it("caps speed and spends Overdrive to reach red", () => {
    assert.equal(travelLimit(1, {}), 1);
    assert.equal(travelLimit(2, {}), 2);
    assert.equal(travelLimit(3, {}), 3);
    assert.equal(travelLimit(4, {}), 3);
    assert.equal(travelLimit(3, { overdrive: "movement", energy: 1 }), 4);
    assert.equal(travelLimit(1, { overdrive: "movement", energy: 1 }), 2);
    assert.equal(travelLimit(3, { overdrive: "movement", energy: 0 }), 3);
    assert.equal(travelLimit(3, { overdrive: "movement", energy: 1, webbed: true }), 3);
    assert.equal(travelLimit(2, { overdrive: "weapons", energy: 1 }), 2);
  });
});

describe("paths", () => {
  const board = boardSet(buildArena().hexes);

  it("approaches along a face and stops short of the target", () => {
    const { path, transversal } = planPath({
      from: { q: 0, r: 0 },
      facing: 0,
      card: "approach",
      dist: 3,
      target: { q: 4, r: 0 },
      board,
    });
    assert.equal(transversal, "low");
    assert.deepEqual(path.at(-1), { q: 3, r: 0 });
    assert.equal(faceStep(path[0], path.at(-1)).dist, 3);
  });

  it("keeps range by closing to distance 3", () => {
    const { path } = planPath({
      from: { q: 5, r: -1 },
      facing: 3,
      card: "keep",
      dist: 3,
      target: { q: 0, r: 0 },
      board,
    });
    assert.equal(distance(path.at(-1), { q: 0, r: 0 }), 3);
  });

  it("orbits without falling onto the target", () => {
    const start = { q: 2, r: 0 };
    const { path, transversal } = planPath({
      from: start,
      facing: 0,
      card: "orbitRight",
      dist: 2,
      target: { q: 0, r: 0 },
      board,
    });
    assert.equal(transversal, "high");
    assert.notEqual(key(path.at(-1).q, path.at(-1).r), "0,0");
    assert.ok(distance(path.at(-1), { q: 0, r: 0 }) >= 1);
    assert.notDeepEqual(path.at(-1), start);
  });

  it("strafes in a straight face line", () => {
    const { path, transversal } = planPath({
      from: { q: 0, r: 0 },
      facing: 0,
      card: "strafeRight",
      dist: 2,
      target: null,
      board,
    });
    assert.equal(transversal, "high");
    const step = faceStep(path[0], path.at(-1));
    assert.equal(step.dist, 2);
  });

  it("hold stays put", () => {
    const { path, transversal } = planPath({
      from: { q: 1, r: -1 },
      facing: 2,
      card: "hold",
      dist: 3,
      target: { q: 0, r: 0 },
      board,
    });
    assert.equal(path.length, 1);
    assert.equal(transversal, "low");
  });
});

describe("guns and collisions", () => {
  const blasters = { optimal: 1, falloff: 1 };

  it("grades range and transversal", () => {
    assert.equal(engagement(1, blasters, "low"), "red");
    assert.equal(engagement(1, blasters, "high"), "yellow");
    assert.equal(engagement(2, blasters, "low"), "yellow");
    assert.equal(engagement(2, blasters, "high"), "miss");
    assert.equal(engagement(3, blasters, "low"), "miss");
  });

  it("adds overdrive damage and promotes yellow when overcharged", () => {
    assert.deepEqual(shotDamage(3, "yellow", {}), { quality: "yellow", damage: 2, raw: "yellow" });
    assert.equal(shotDamage(3, "yellow", { overdrive: true }).damage, 4);
    const charged = shotDamage(3, "yellow", { overdrive: true, overcharge: true });
    assert.equal(charged.quality, "red");
    assert.equal(charged.damage, 5);
    assert.equal(shotDamage(4, "red", { overdrive: true }).damage, 6);
  });

  it("rams hull-only and respects dampeners", () => {
    assert.deepEqual(collisionOutcome([], 1, [], 1), { damage: 1, knock: 1 });
    assert.deepEqual(collisionOutcome([], 1, [], 3), { damage: 3, knock: 3 });
    assert.deepEqual(collisionOutcome([], 3, [], 1), { damage: 1, knock: 1 });
    assert.deepEqual(collisionOutcome(["dampener"], 1, [], 3), { damage: 2, knock: 1 });
    assert.deepEqual(collisionOutcome([], 2, ["ram"], 2), { damage: 2, knock: 3 });
    assert.deepEqual(collisionOutcome(["dampener"], 2, [], 2), { damage: 0, knock: 0 });
  });
});

describe("deployment", () => {
  it("parks every ship on a unique arena hex", () => {
    const arena = buildArena();
    assert.equal(arena.hexes.length, 61);
    const board = boardSet(arena.hexes);
    for (const count of [2, 3, 4]) {
      const slots = deploymentSlots(count, board);
      const seen = new Set();
      assert.equal(slots.length, count);
      for (const group of slots) {
        assert.equal(group.length, 3);
        for (const spot of group) {
          const k = key(spot.q, spot.r);
          assert.equal(board.has(k), true, k);
          assert.equal(seen.has(k), false, k);
          seen.add(k);
        }
      }
    }
  });
});
