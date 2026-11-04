import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { key, distance, faceStep } from "../shared/hex.js";
import {
  applyHit,
  buildArena,
  boardSet,
  collisionOutcome,
  deploymentSlots,
  planPath,
  cardReach,
  starterFleet,
  travelLimit,
  validateFleet,
  weaponShot,
} from "../shared/rules.js";
import { CATALOG } from "../shared/catalog.js";

describe("fleet racks", () => {
  it("accepts the sample fleet and rejects an illegal fit", () => {
    assert.equal(validateFleet(starterFleet()), null);
    const heavy = [{ hull: "rifter", modules: ["extender"] }, starterFleet()[1], starterFleet()[2]];
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
    assert.equal(travelLimit(4, {}), 4);
    assert.equal(travelLimit(3, { overdrive: "movement", energy: 1 }), 4);
    assert.equal(travelLimit(1, { overdrive: "movement", energy: 1 }), 2);
    assert.equal(travelLimit(3, { overdrive: "movement", energy: 0 }), 3);
    assert.equal(travelLimit(3, { overdrive: "movement", energy: 1, webbed: true }), 3);
    assert.equal(travelLimit(2, { overdrive: "weapons", energy: 1 }), 2);
  });
});

describe("paths", () => {
  const board = boardSet(buildArena().hexes);

  it("approaches along facing for the light-blue band", () => {
    const { path, transversal, facing } = planPath({
      from: { q: 0, r: 0 },
      facing: 0,
      card: "approach",
      color: "lb",
      board,
    });
    assert.equal(cardReach("approach", "lb"), 3);
    assert.equal(transversal, "low");
    assert.equal(facing, 0);
    assert.deepEqual(path.at(-1), { q: 3, r: 0 });
    assert.equal(faceStep(path[0], path.at(-1)).dist, 3);
  });

  it("keeps range by backing straight away from the nose", () => {
    const { path, facing } = planPath({
      from: { q: 0, r: 0 },
      facing: 0,
      card: "keep",
      color: "lg",
      board,
    });
    assert.equal(facing, 0);
    assert.deepEqual(path.at(-1), { q: -3, r: 0 });
  });

  it("orbits right along the printed arc and turns inward", () => {
    const { path, transversal, facing } = planPath({
      from: { q: 0, r: 0 },
      facing: 0,
      card: "orbitRight",
      color: "lb",
      board,
    });
    assert.equal(transversal, "high");
    assert.equal(path.length, 4);
    assert.deepEqual(path.at(-1), { q: 1, r: 2 });
    assert.equal(facing, 2);
    assert.notDeepEqual(path.at(-1), { q: 0, r: 0 });
  });

  it("strafes one face forward of the bow", () => {
    const { path, transversal, facing } = planPath({
      from: { q: 0, r: 0 },
      facing: 0,
      card: "strafeRight",
      color: "lg",
      board,
    });
    assert.equal(transversal, "high");
    assert.equal(facing, 0);
    assert.equal(path.length, 4);
    const step = faceStep(path[0], path[1]);
    assert.equal(step.dist, 1);
    assert.equal(key(path.at(-1).q, path.at(-1).r), key(path[3].q, path[3].r));
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
  const blasters = CATALOG.blasters;

  it("reads the printed range bands", () => {
    assert.equal(weaponShot(blasters, 1).quality, "red");
    assert.equal(weaponShot(blasters, 1).damage, 4);
    assert.equal(weaponShot(blasters, 3).quality, "yellow");
    assert.equal(weaponShot(blasters, 3).damage, 2);
    assert.equal(weaponShot(blasters, 4).quality, "miss");
    assert.equal(weaponShot(blasters, 1, { overdrive: true }).damage, 5);
    const charged = weaponShot(blasters, 3, { overdrive: true, overcharge: true });
    assert.equal(charged.quality, "red");
    assert.equal(charged.damage, 5);
  });

  it("reduces armor hits and pays ammo only on the first layer", () => {
    const armored = { shield: 0, armor: 3, hullHp: 3 };
    const direct = applyHit(armored, 3, { ammo: "kinetic" });
    assert.equal(direct.layer, "armor");
    assert.equal(direct.dealt, 3);
    assert.equal(armored.armor, 0);
    const screened = { shield: 1, armor: 3, hullHp: 3 };
    const through = applyHit(screened, 3, { ammo: "kinetic" });
    assert.equal(through.layer, "shield");
    assert.equal(through.shield, 1);
    assert.equal(screened.armor, 1);
    assert.equal(through.knock, 0);
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
    assert.equal(arena.foundations.length, 4);
    assert.ok(arena.hexes.length > 100);
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
