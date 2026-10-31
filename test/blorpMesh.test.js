import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { makeBlorp, makeToken } from "../src/meshes.js";

describe("slime mesh", () => {
  it("has a black top hat and no white dot on the crown", () => {
    const g = makeBlorp("#5b9dff");
    const hat = g.userData.hat;
    assert.ok(hat);
    const hatBox = new THREE.Box3().setFromObject(hat);
    const midX = (hatBox.min.x + hatBox.max.x) / 2;
    const midZ = (hatBox.min.z + hatBox.max.z) / 2;
    assert.ok(Math.abs(midX) < 0.02);
    assert.ok(Math.abs(midZ) < 0.02);
    assert.ok(hatBox.max.y > 0.55);
    assert.ok(Math.abs(g.userData.hatTop - hatBox.max.y) < 1e-4);

    hat.traverse((obj) => {
      if (!obj.isMesh) return;
      const c = obj.material.color;
      assert.ok(c.r < 0.15 && c.g < 0.15 && c.b < 0.15);
    });

    g.traverse((obj) => {
      if (!obj.isMesh || !obj.material?.color) return;
      const c = obj.material.color;
      if (c.r < 0.95 || c.g < 0.95 || c.b < 0.95) return;
      assert.ok(obj.position.y < 0.22);
    });
  });

  it("lays a slime drop flat on the hex", () => {
    const token = makeToken("#e6b325");
    const box = new THREE.Box3().setFromObject(token);
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    assert.ok(width > 0.9);
    assert.ok(height < 0.08);
    assert.ok(box.min.y >= -0.001);
  });
});
