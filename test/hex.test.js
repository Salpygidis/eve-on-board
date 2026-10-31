import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  distance,
  neighbors,
  hexToWorld,
  hexRound,
  ring,
  hexLine,
  key,
  sameHexLayout,
  DIRS,
  faceStep,
  onFaceLine,
} from "../shared/hex.js";
import { buildBoard, foundationCount, hexCount, plateOrigins } from "../server/map.js";
import { mulberry32 } from "../shared/rng.js";

describe("hex math", () => {
  it("counts a radius-3 hex as 37 cells", () => {
    assert.equal(ring(3).length, 37);
  });

  it("builds an island of full hexes only", () => {
    const board = buildBoard(3, mulberry32(42));
    assert.equal(hexCount(board.hexes), 39);
    assert.equal(board.starts.length, 3);
    assert.equal(board.captures.length, 2);
    assert.equal(board.fruits.length, 9);
    for (const type of ["apple", "banana", "grapes"]) {
      assert.equal(board.fruits.filter((f) => f.type === type).length, 3);
    }
    for (const [q, r] of [
      [3, -4],
      [-3, -1],
      [3, 1],
      [-3, 4],
    ]) {
      assert.ok(board.hexes[key(q, r)], `${q},${r} is a full foundation hex`);
    }
    for (const [q, r] of [
      [0, -3],
      [0, 3],
      [4, -2],
      [-4, 2],
      [2, -4],
      [-2, 4],
    ]) {
      assert.equal(board.hexes[key(q, r)], undefined);
    }
    for (const s of board.starts) {
      assert.ok(board.hexes[key(s.q, s.r)], `${s.q},${s.r} is a start`);
    }
  });

  it("treats one hex side as a straight line", () => {
    const origin = { q: 0, r: 0 };
    for (const d of DIRS) {
      const step = faceStep(origin, { q: d.q * 2, r: d.r * 2 });
      assert.deepEqual(step, { q: d.q, r: d.r, dist: 2 });
      const a = hexToWorld(d.q, d.r);
      const b = hexToWorld(d.q * 2, d.r * 2);
      const cross = a.x * b.z - a.z * b.x;
      assert.ok(Math.abs(cross) < 1e-9);
    }
    // One step east, then a turn. These are the six bends at distance 2.
    for (const [q, r] of [
      [2, -1],
      [1, -2],
      [-1, -1],
      [-2, 1],
      [-1, 2],
      [1, 1],
    ]) {
      assert.equal(faceStep(origin, { q, r }), null);
      assert.equal(onFaceLine(origin, { q, r }, 2), false);
    }
  });

  it("neighbor distance is 1", () => {
    const h = { q: 0, r: 0 };
    for (const n of neighbors(h)) {
      assert.equal(distance(h, n), 1);
    }
  });

  it("round-trips world coordinates at the origin", () => {
    const { x, z } = hexToWorld(2, -1);
    const back = hexRound(
      ((Math.sqrt(3) / 3) * x - (1 / 3) * z) / 1.08,
      ((2 / 3) * z) / 1.08
    );
    assert.equal(back.q, 2);
    assert.equal(back.r, -1);
  });

  it("draws a straight hex line", () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 2, r: 0 });
    assert.equal(line.length, 3);
    assert.equal(key(line[1].q, line[1].r), "1,0");
  });

  it("never places fruit or crystals on a tree", () => {
    for (const players of [2, 3, 4, 5, 6, 10]) {
      for (let seed = 1; seed <= 80; seed++) {
        const board = buildBoard(players, mulberry32(seed));
        const trees = new Set(
          Object.values(board.hexes)
            .filter((h) => h.terrain === "tree")
            .map((h) => key(h.q, h.r))
        );
        for (const item of [...board.fruits, ...board.captures]) {
          const cell = board.hexes[key(item.q, item.r)];
          assert.ok(cell, `${item.id} is on the board`);
          assert.equal(cell.terrain, "open", `${item.id} on ${cell.terrain}`);
          assert.equal(trees.has(key(item.q, item.r)), false);
        }
        for (const item of board.captures) {
          assert.equal(board.hexes[key(item.q, item.r)].elevation || 0, 0, `${item.id} on a hill`);
        }
        assertPlateQuotas(board, players, seed);
      }
    }
  });

  it("treats a changed tree as a different board", () => {
    const tree = [{ q: 1, r: 0, terrain: "tree", elevation: 0 }];
    const open = [{ q: 1, r: 0, terrain: "open", elevation: 0 }];
    assert.equal(sameHexLayout(tree, tree), true);
    assert.equal(sameHexLayout(tree, open), false);
  });

  it("keeps a walkable neighbor at every start", () => {
    for (const players of [5, 6, 10]) {
      for (let seed = 1; seed <= 20; seed++) {
        const board = buildBoard(players, mulberry32(seed));
        assert.equal(board.starts.length, players);
        for (const s of board.starts) {
          const open = neighbors(s).some((n) => {
            const cell = board.hexes[key(n.q, n.r)];
            return cell && cell.terrain !== "tree";
          });
          assert.equal(open, true, `${players} players seed ${seed}`);
        }
      }
    }
  });

  it("places one of each fruit and two crystals per foundation", () => {
    for (const players of [2, 4, 5, 6, 10]) {
      const board = buildBoard(players, mulberry32(3));
      assert.equal(board.captures.length, foundationCount(players) * 2, `${players} crystals`);
      assert.equal(board.fruits.length, players * 3, `${players} fruit`);
      for (const type of ["apple", "banana", "grapes"]) {
        assert.equal(
          board.fruits.filter((f) => f.type === type).length,
          players,
          `${players} ${type}`
        );
      }
    }
  });

  it("joins a second foundation from six racers up", () => {
    assert.equal(foundationCount(5), 1);
    assert.equal(foundationCount(6), 2);
    assert.equal(foundationCount(10), 2);

    const one = buildBoard(5, mulberry32(7));
    assert.equal(one.foundations.length, 1);
    assert.equal(one.captures.length, 2);
    assert.equal(new Set(one.starts.map((s) => key(s.q, s.r))).size, 5);
    assert.equal(hexCount(one.hexes), 39);

    const two = buildBoard(6, mulberry32(7));
    assert.equal(two.foundations.length, 2);
    assert.deepEqual(two.foundations, plateOrigins(2));
    assert.equal(two.captures.length, 4);
    assert.equal(hexCount(two.hexes), 39 * 2);
    assert.equal(linkedPlates(two), true);

    const ten = buildBoard(10, mulberry32(9));
    assert.equal(ten.foundations.length, 2);
    assert.equal(ten.captures.length, 4);
    assert.equal(linkedPlates(ten), true);
    assert.equal(new Set(ten.starts.map((s) => key(s.q, s.r))).size, 10);
  });
});

function linkedPlates(board) {
  const map = board.hexes;
  const open = Object.values(map).filter((h) => h.terrain !== "tree");
  if (!open.length) return false;
  const seen = new Set([key(open[0].q, open[0].r)]);
  const queue = [open[0]];
  while (queue.length) {
    const h = queue.shift();
    for (const n of neighbors(h)) {
      const k = key(n.q, n.r);
      const cell = map[k];
      if (!cell || cell.terrain === "tree" || seen.has(k)) continue;
      seen.add(k);
      queue.push(cell);
    }
  }
  return seen.size === open.length;
}

function nearestPlate(cell, origins) {
  let best = 0;
  let bestD = Infinity;
  origins.forEach((origin, i) => {
    const d = distance(cell, origin);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function assertPlateQuotas(board, players, seed) {
  const groups = board.foundations.map(() => ({ trees: 0, water: 0, height: 0, crystals: 0 }));
  for (const cell of Object.values(board.hexes)) {
    const group = groups[nearestPlate(cell, board.foundations)];
    if (cell.terrain === "tree") group.trees += 1;
    if (cell.terrain === "water") group.water += 1;
    if ((cell.elevation || 0) > 0) group.height += 1;
  }
  for (const cap of board.captures) {
    const cell = board.hexes[key(cap.q, cap.r)];
    groups[nearestPlate(cell, board.foundations)].crystals += 1;
  }
  groups.forEach((group, i) => {
    const where = `${players} players seed ${seed} foundation ${i}`;
    assert.ok(group.trees >= 4, `${where} has ${group.trees} trees`);
    assert.ok(group.water >= 4, `${where} has ${group.water} water`);
    assert.ok(group.height >= 4, `${where} has ${group.height} height`);
    assert.equal(group.crystals, 2, `${where} crystals`);
  });
}
