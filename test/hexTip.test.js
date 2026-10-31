import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeHex } from "../src/hexTip.js";

describe("hex hover tip", () => {
  it("names the ship and the bomb on a hex", () => {
    const lines = describeHex(
      {
        ships: [
          {
            q: 1,
            r: 0,
            name: "Rifter",
            hullName: "Rifter",
            shield: 2,
            shieldMax: 3,
            hullHp: 3,
            hullMax: 3,
            playerId: "a",
          },
        ],
        bombs: [{ q: 1, r: 0, ownerName: "Tempest" }],
        players: [{ id: "a", name: "Rook" }],
      },
      1,
      0
    );
    const text = lines.map((line) => line.text).join(" ");
    assert.match(text, /Rifter/);
    assert.match(text, /shield 2\/3/);
    assert.match(text, /Tempest/);
    assert.match(text, /Smart bomb/);
  });
});
