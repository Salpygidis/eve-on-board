import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { HEX_SIZE, hexToWorld, ring } from "../shared/hex.js";
import {
  capScaleFor,
  foundationPose,
  PIECE_SPAN,
  FOUNDATION_PITCH,
  FOUNDATION_FLOOR_Y,
  FOUNDATION_RIM_Y,
} from "../shared/boardFit.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  topCapGeometry,
  withoutTileFloors,
  LIQUID_TOP,
  HEIGHT_TOP,
  FOUNDATION_TOP,
  TOP_NY,
} from "../src/boardModels.js";
import { layoutBoard, makeTile, tileDepth, useBoardModels } from "../src/meshes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const models = join(root, "public", "models");

function loadObj(name) {
  const verts = [];
  let up = 0;
  let down = 0;
  for (const line of readFileSync(join(models, name), "utf8").split(/\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      verts.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith("f ")) {
      const ids = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((token) => +token.split("/")[0] - 1);
      const [a, b, c] = ids.map((i) => verts[i]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny >= 0) up += ny;
      else down -= ny;
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let far = { r: 0, deg: 0 };
  for (const [x, y, z] of verts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    const r = Math.hypot(x, z);
    if (r > far.r) far = { r, deg: (Math.atan2(z, x) * 180) / Math.PI };
  }
  return {
    verts: verts.length,
    up,
    down,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    far,
    absX: Math.max(Math.abs(minX), Math.abs(maxX)),
    absZ: Math.max(Math.abs(minZ), Math.abs(maxZ)),
  };
}

function pointyError(deg) {
  let best = 180;
  for (let k = 0; k < 6; k++) {
    let d = Math.abs(deg - (30 + 60 * k));
    d %= 360;
    best = Math.min(best, d, 360 - d);
  }
  return best;
}

function island() {
  const cells = ring(3);
  cells.push({ q: 4, r: -2 }, { q: -4, r: 2 });
  return cells;
}

describe("board models", () => {
  const metrics = JSON.parse(readFileSync(join(models, "metrics.json"), "utf8"));
  const liquid = loadObj("liquid.obj");
  const height = loadObj("height.obj");
  const foundation = loadObj("foundation.obj");

  it("sits the water and height tiles on y=0 with a pointy-top vertex", () => {
    for (const mesh of [liquid, height]) {
      assert.ok(Math.abs(mesh.minY) < 1e-4);
      assert.ok(mesh.maxY > 0.1);
      assert.ok(mesh.far.r > 0.98 && mesh.far.r < 1.02);
      assert.ok(mesh.absZ > mesh.absX);
      assert.ok(pointyError(mesh.far.deg) < 12, `vertex at ${mesh.far.deg}°`);
      assert.ok(mesh.up > 0 && mesh.down > 0);
    }
    assert.ok(Math.abs(liquid.maxY - metrics.liquid.height) < 1e-3);
    assert.ok(Math.abs(height.maxY - metrics.height.height) < 1e-3);
    assert.ok(Math.abs(liquid.absX - metrics.liquid.maxX) < 0.02);
    assert.ok(Math.abs(height.absX - metrics.height.maxX) < 0.02);
  });

  it("fills each hex a little past the shared edge", () => {
    const neighbor = HEX_SIZE * Math.sqrt(3);
    for (const mesh of [liquid, height]) {
      const scale = capScaleFor(mesh.absX);
      const width = 2 * mesh.absX * scale;
      assert.ok(Math.abs(width / neighbor - PIECE_SPAN) < 1e-6);
      assert.ok(mesh.far.r * scale < HEX_SIZE);
    }
  });

  it("turns the foundation's flat-top hexes onto the game grid", () => {
    assert.ok(Math.abs(foundation.minY) < 1e-3);
    assert.ok(Math.abs(foundation.maxX - foundation.minX - metrics.foundation.width) < 0.05);
    assert.ok(Math.abs(foundation.maxZ - foundation.minZ - metrics.foundation.depth) < 0.05);

    const pose = foundationPose();
    const plate = new THREE.Object3D();
    plate.rotation.y = pose.yaw;
    plate.scale.setScalar(pose.scale);
    plate.position.set(pose.x, 0, pose.z);
    plate.updateMatrixWorld();
    const worldOf = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(plate.matrixWorld);

    // Interior centers measured on foundation.obj, and the axial cell they belong to.
    const centers = [
      [0.0, -77.84, 0, -2],
      [-33.77, -58.43, -1, -1],
      [-0.02, -39.01, 0, -1],
      [33.64, -19.47, 1, -1],
      [-67.56, -39.06, -2, 0],
      [-0.02, -0.14, 0, 0],
      [67.58, 39.05, 2, 0],
      [0.01, 39.04, 0, 1],
      [33.74, 58.52, 1, 1],
      [-0.04, 78.01, 0, 2],
    ];
    for (const [x, z, q, r] of centers) {
      const world = worldOf(x, z);
      const hex = hexToWorld(q, r);
      const miss = Math.hypot(world.x - hex.x, world.z - hex.z);
      assert.ok(miss < 0.03, `${q},${r} is ${miss.toFixed(3)} off its foundation hex`);
    }

    for (const cell of island()) {
      const hex = hexToWorld(cell.q, cell.r);
      const point = new THREE.Vector3(hex.x, 0, hex.z);
      plate.worldToLocal(point);
      assert.ok(point.x > foundation.minX && point.x < foundation.maxX);
      assert.ok(point.z > foundation.minZ && point.z < foundation.maxZ);
    }
  });

  it("stands pieces on the plate, the water, and the hill", () => {
    useBoardModels({
      foundation: {},
      foundationSize: {
        width: foundation.maxX - foundation.minX,
        depth: foundation.maxZ - foundation.minZ,
        height: foundation.maxY - foundation.minY,
      },
      liquidHeight: liquid.maxY - liquid.minY,
      heightHeight: height.maxY - height.minY,
      pieceMaxX: Math.max(liquid.absX, height.absX),
    });
    const cells = island();
    const layout = layoutBoard(cells);
    assert.ok(layout);
    const open = tileDepth({ terrain: "open", elevation: 0 });
    const tree = tileDepth({ terrain: "tree", elevation: 0 });
    const water = tileDepth({ terrain: "water", elevation: -1 });
    const hill = tileDepth({ terrain: "open", elevation: 1 });
    const scale = capScaleFor(Math.max(liquid.absX, height.absX));
    assert.equal(tree, open);
    assert.ok(Math.abs(open - (foundation.maxY - foundation.minY) * layout.scale) < 1e-6);
    assert.ok(Math.abs(water - liquid.maxY * scale) < 1e-6);
    assert.ok(Math.abs(hill - height.maxY * scale) < 1e-6);
    assert.ok(water > open);
    assert.ok(hill > water);
    assert.ok(hill < 2);
    const pool = tileDepth({ terrain: "open", elevation: 0, pool: true });
    assert.equal(pool, water);
  });

  it("prints the crystal photo on the liquid top and keeps the hex open", () => {
    const liquidGeo = new THREE.BufferGeometry();
    liquidGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 0, 0.4, 0], 3)
    );
    const heightGeo = liquidGeo.clone();
    const liquidTop = flatTop(0.4);
    const heightTop = flatTop(0.8);
    const crystalMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const waterMat = new THREE.MeshBasicMaterial({ color: "#3ec8ea" });
    const rockMat = new THREE.MeshBasicMaterial({ color: "#a97449" });
    useBoardModels({
      foundation: new THREE.BufferGeometry(),
      liquid: liquidGeo,
      liquidMat: new THREE.MeshStandardMaterial(),
      liquidTop,
      crystalTopMat: crystalMat,
      waterTopMat: waterMat,
      height: heightGeo,
      heightMat: new THREE.MeshStandardMaterial(),
      heightTop,
      rockTopMat: rockMat,
      foundationSize: { width: 2, depth: 2, height: 0.2 },
      liquidHeight: 0.4,
      heightHeight: 0.8,
      pieceMaxX: 0.6,
    });
    layoutBoard([{ q: 0, r: 0, terrain: "open" }]);

    const poolHex = { q: 1, r: 0, terrain: "open", elevation: 0, pool: true };
    const pool = makeTile(poolHex);
    assert.equal(pool.userData.terrain, "open");
    assert.ok(pool.userData.crystalMat);
    assert.notEqual(pool.userData.crystalMat, crystalMat);
    const poolCap = photoOn(pool, liquidGeo);
    assert.equal(poolCap.geometry, liquidTop);
    assert.equal(poolCap.material, pool.userData.crystalMat);
    assert.equal(poolCap.parent.material !== pool.userData.crystalMat, true);
    missesRay(poolCap);

    const water = makeTile({ q: 0, r: 0, terrain: "water", elevation: -1 });
    assert.equal(water.userData.crystalMat, undefined);
    const waterCap = photoOn(water, liquidGeo);
    assert.equal(waterCap.material, waterMat);
    assert.equal(waterCap.geometry, liquidTop);
    missesRay(waterCap);

    const hill = makeTile({ q: 0, r: 1, terrain: "open", elevation: 1 });
    const rockCap = photoOn(hill, heightGeo);
    assert.equal(rockCap.material, rockMat);
    assert.equal(rockCap.geometry, heightTop);
    missesRay(rockCap);

    const open = makeTile({ q: 1, r: -1, terrain: "open", elevation: 0 });
    assert.equal(open.userData.crystalMat, undefined);
    open.traverse((obj) => {
      if (!obj.isMesh) return;
      assert.notEqual(obj.material, waterMat);
      assert.notEqual(obj.material, rockMat);
      assert.notEqual(obj.material, crystalMat);
      assert.notEqual(obj.geometry, liquidTop);
      assert.notEqual(obj.geometry, heightTop);
    });
  });

  it("keeps each photo on the upper horizontal faces", () => {
    const cases = [
      ["liquid.obj", LIQUID_TOP, 0.12],
      ["height.obj", HEIGHT_TOP, 0.3],
      ["foundation.obj", FOUNDATION_TOP, 2.5],
    ];
    for (const [name, fraction, lowest] of cases) {
      const src = meshGeometry(name);
      let maxY = -Infinity;
      const pos = src.attributes.position;
      for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
      const srcTris = (src.index ? src.index.count : pos.count) / 3;
      const cap = topCapGeometry(src, fraction);
      const tris = faceRecords(cap);
      assert.ok(tris.length > 0 && tris.length < srcTris, name);
      let nearRim = false;
      let nearFloor = false;
      for (const tri of tris) {
        assert.ok(tri.y + 1e-4 >= maxY * fraction, `${name} centroid ${tri.y}`);
        assert.ok(tri.ny + 1e-4 >= TOP_NY, `${name} ny ${tri.ny}`);
        assert.ok(tri.minY > lowest, `${name} vertex ${tri.minY}`);
        if (name === "foundation.obj" && Math.abs(tri.y - FOUNDATION_RIM_Y) < 0.15) nearRim = true;
        if (name === "foundation.obj" && Math.abs(tri.y - FOUNDATION_FLOOR_Y) < 0.2) nearFloor = true;
      }
      if (name === "foundation.obj") {
        assert.ok(nearRim, "grass misses the foundation rim");
        assert.ok(nearFloor, "grass misses the groove floors");
      }
    }
  });

  it("maps a photo upright, image top toward local -z", () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          0, 1, 0,
          2, 1, 0,
          2, 1, -4,
          0, 0, 0,
        ],
        3
      )
    );
    geo.setIndex([0, 1, 2]);
    const cap = topCapGeometry(geo, 0.5);
    assert.equal(cap.attributes.position.count, 3);
    const pos = cap.attributes.position;
    const uv = cap.attributes.uv;
    let far = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - 2) < 1e-6 && Math.abs(pos.getZ(i) + 4) < 1e-6) {
        assert.ok(Math.abs(uv.getX(i) - 1) < 1e-5);
        assert.ok(Math.abs(uv.getY(i) - 1) < 1e-5);
        far = true;
      }
      if (Math.abs(pos.getX(i)) < 1e-6 && Math.abs(pos.getZ(i)) < 1e-6) {
        assert.ok(Math.abs(uv.getX(i)) < 1e-5);
        assert.ok(Math.abs(uv.getY(i)) < 1e-5);
      }
    }
    assert.ok(far);
  });

  it("lifts the hex pad off a tile so the crystal is not under a hex", () => {
    const src = meshGeometry("foundation.obj");
    const cut = withoutTileFloors(src, { q: 0, r: 0 }, new Set(["0,-2"]));
    assert.notEqual(cut, src);
    const near = (geo, x, z, yMin, yMax) => {
      const pos = geo.attributes.position;
      const index = geo.index;
      const count = index ? index.count : pos.count;
      const at = (slot, axis) => {
        const vi = index ? index.getX(slot) : slot;
        return axis === 0 ? pos.getX(vi) : axis === 1 ? pos.getY(vi) : pos.getZ(vi);
      };
      let n = 0;
      for (let i = 0; i < count; i += 3) {
        const cx = (at(i, 0) + at(i + 1, 0) + at(i + 2, 0)) / 3;
        const cy = (at(i, 1) + at(i + 1, 1) + at(i + 2, 1)) / 3;
        const cz = (at(i, 2) + at(i + 1, 2) + at(i + 2, 2)) / 3;
        if (cy < yMin || cy > yMax) continue;
        if (Math.hypot(cx - x, cz - z) < 10) n += 1;
      }
      return n;
    };
    assert.ok(near(src, 0, -77.84, 2.9, 3.7) > 0, "the socket has a hex pad");
    assert.equal(near(cut, 0, -77.84, 2.9, 3.7), 0);
    assert.ok(near(cut, 0, -77.84, 4.2, 4.6) > 0, "the rim around the socket stays");
    assert.ok(near(cut, 0, 0, 2.9, 3.7) > 0, "other hex pads stay");
    assert.equal(withoutTileFloors(src, { q: 0, r: 0 }, new Set()), src);
  });

  it("repeats grass once per foundation hex", () => {
    const pitch = FOUNDATION_PITCH;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 4, 0, pitch, 4, 0, 0, 4, -pitch], 3)
    );
    const cap = topCapGeometry(geo, 0.5, { repeat: pitch });
    const pos = cap.attributes.position;
    const uv = cap.attributes.uv;
    assert.equal(pos.count, 3);
    for (let i = 0; i < pos.count; i++) {
      assert.ok(Math.abs(uv.getX(i) - pos.getX(i) / pitch) < 1e-5);
      assert.ok(Math.abs(uv.getY(i) - -pos.getZ(i) / pitch) < 1e-5);
    }
  });
});

function flatTop(y) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.5, y, -0.5, 0.5, y, -0.5, 0, y, 0.5], 3)
  );
  return geo;
}

function photoOn(root, bodyGeo) {
  let body = null;
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry === bodyGeo) body = obj;
  });
  assert.ok(body);
  assert.equal(body.children.length, 1);
  const cap = body.children[0];
  assert.equal(cap.isMesh, true);
  return cap;
}

function missesRay(cap) {
  const hits = [];
  cap.raycast(null, hits);
  assert.equal(hits.length, 0);
}

function meshGeometry(name) {
  const text = readFileSync(join(models, name), "utf8");
  const root = new OBJLoader().parse(text);
  let geo = null;
  root.traverse((obj) => {
    if (!geo && obj.isMesh) geo = obj.geometry;
  });
  assert.ok(geo, name);
  return geo;
}

function faceRecords(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const out = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    fn.crossVectors(ab, ac);
    const len = fn.length() || 1;
    out.push({
      y: (a.y + b.y + c.y) / 3,
      ny: Math.abs(fn.y) / len,
      minY: Math.min(a.y, b.y, c.y),
    });
  }
  return out;
}
