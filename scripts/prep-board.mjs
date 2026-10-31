/**
 * Turn the source models into one hex-sized piece each.
 * The foundation STL is the whole base plate. It is decimated and centered.
 * Liquid-Tile and Single-Hex become one hex each: radius 1, bottom on y=0,
 * a vertex toward the pointy-top direction (about +30 degrees).
 *
 * Source (not required at runtime):
 *   OneDrive/Documents/SOURCE/3D/OBJ Files/foundation.STL
 *   OneDrive/Documents/SOURCE/3D/OBJ Files/Liquid-Tile.obj
 *   OneDrive/Documents/SOURCE/3D/OBJ Files/Single-Hex.obj
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SRC = "C:/Users/Owner/OneDrive/Documents/SOURCE/3D/OBJ Files";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "models");

function rotateY(p, phi) {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

function boundsOf(verts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of verts) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  return { min, max };
}

function eachVert(triangles, fn) {
  for (const tri of triangles) for (const p of tri) fn(p);
}

function shellVerts(triangles) {
  const all = [];
  eachVert(triangles, (p) => all.push(p));
  const { min, max } = boundsOf(all);
  const cut = min[1] + (max[1] - min[1]) * 0.2;
  const shell = all.filter((p) => p[1] >= cut);
  return shell.length > 20 ? shell : all;
}

function bboxCenterXZ(verts) {
  const { min, max } = boundsOf(verts);
  return [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
}

function pointAngle(triangles) {
  const shell = shellVerts(triangles);
  const [cx, cz] = bboxCenterXZ(shell);
  let rmax = 0;
  for (const p of shell) rmax = Math.max(rmax, Math.hypot(p[0] - cx, p[2] - cz));
  const bins = new Float64Array(360);
  for (const p of shell) {
    const dx = p[0] - cx;
    const dz = p[2] - cz;
    const r = Math.hypot(dx, dz);
    if (r < rmax * 0.9) continue;
    let deg = Math.round((Math.atan2(dz, dx) * 180) / Math.PI);
    if (deg < 0) deg += 360;
    bins[deg] += r;
  }
  let best = 0;
  for (let i = 1; i < 360; i++) if (bins[i] > bins[best]) best = i;
  return (best * Math.PI) / 180;
}

function faceUp(triangles) {
  let up = 0;
  let down = 0;
  for (const [a, b, c] of triangles) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const ny = ux * vz - uz * vx;
    if (ny >= 0) up += ny;
    else down -= ny;
  }
  return { up, down };
}

function alignPointToZ(triangles, mode) {
  if (mode === "bbox") {
    const all = [];
    eachVert(triangles, (p) => all.push(p));
    const { min, max } = boundsOf(all);
    const wideX = max[0] - min[0];
    const wideZ = max[2] - min[2];
    if (wideX > wideZ) return triangles.map((tri) => tri.map((p) => rotateY(p, Math.PI / 2)));
    return triangles;
  }
  const phi = pointAngle(triangles) - Math.PI / 2;
  return triangles.map((tri) => tri.map((p) => rotateY(p, phi)));
}

export function normalizeTriangles(triangles, mode = "point") {
  let tris = triangles.map((tri) => tri.map((p) => p.slice()));
  const facing = faceUp(tris);
  if (facing.down > facing.up) tris = tris.map(([a, b, c]) => [a, c, b]);

  tris = alignPointToZ(tris, mode);

  const shell = shellVerts(tris);
  const [cx, cz] = bboxCenterXZ(shell);
  const all = [];
  eachVert(tris, (p) => all.push(p));
  const y0 = boundsOf(all).min[1];
  tris = tris.map((tri) => tri.map((p) => [p[0] - cx, p[1] - y0, p[2] - cz]));

  const shell2 = shellVerts(tris);
  const [ox, oz] = bboxCenterXZ(shell2);
  let radius = 0;
  for (const p of shell2) radius = Math.max(radius, Math.hypot(p[0] - ox, p[2] - oz));
  if (!(radius > 0)) throw new Error("Model has no radius");
  const s = 1 / radius;
  tris = tris.map((tri) => tri.map((p) => [(p[0] - ox) * s, p[1] * s, (p[2] - oz) * s]));

  const fitted = [];
  eachVert(tris, (p) => fitted.push(p));
  const box = boundsOf(fitted);
  let maxX = 0;
  let maxZ = 0;
  let peak = 0;
  for (const p of shellVerts(tris)) {
    maxX = Math.max(maxX, Math.abs(p[0]));
    maxZ = Math.max(maxZ, Math.abs(p[2]));
    const r = Math.hypot(p[0], p[2]);
    if (r > 0.9) {
      const deg = Math.abs((Math.atan2(p[2], p[0]) * 180) / Math.PI);
      const fromZ = Math.min(Math.abs(deg - 90), Math.abs(deg - 270));
      if (fromZ < Math.abs(peak - 90) || peak === 0) peak = deg > 180 ? deg - 360 : deg;
    }
  }
  return {
    triangles: tris,
    height: box.max[1] - box.min[1],
    minY: box.min[1],
    maxX,
    maxZ,
    radius: 1,
  };
}

function weldAndWrite(file, triangles) {
  const map = new Map();
  const verts = [];
  const faces = [];
  const keyOf = (p) => `${p[0].toFixed(4)} ${p[1].toFixed(4)} ${p[2].toFixed(4)}`;
  for (const tri of triangles) {
    const face = [];
    for (const p of tri) {
      const key = keyOf(p);
      let id = map.get(key);
      if (!id) {
        verts.push(p);
        id = verts.length;
        map.set(key, id);
      }
      face.push(id);
    }
    faces.push(face);
  }
  const out = fs.createWriteStream(file);
  out.write("# Blorps board piece. Radius 1, bottom at y=0, a point toward +Z.\n");
  for (const p of verts) out.write(`v ${p[0].toFixed(5)} ${p[1].toFixed(5)} ${p[2].toFixed(5)}\n`);
  for (const f of faces) out.write(`f ${f[0]} ${f[1]} ${f[2]}\n`);
  return new Promise((resolve, reject) => {
    out.end(() => resolve({ verts: verts.length, faces: faces.length }));
    out.on("error", reject);
  });
}

function readObjTriangles(file) {
  const verts = [];
  const tris = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      verts.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith("f ")) {
      const ids = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((tok) => {
          const n = Number(tok.split("/")[0]);
          return n < 0 ? verts.length + n : n - 1;
        });
      for (let i = 1; i < ids.length - 1; i++) {
        tris.push([verts[ids[0]], verts[ids[i]], verts[ids[i + 1]]]);
      }
    }
  }
  return tris;
}

function readFoundationPlate(step = 0.55) {
  const fd = fs.openSync(path.join(SRC, "foundation.STL"), "r");
  const header = Buffer.alloc(84);
  fs.readSync(fd, header, 0, 84, 0);
  const count = header.readUInt32LE(80);
  const triSize = 50;
  const chunk = 30000;
  const buf = Buffer.alloc(chunk * triSize);
  let left = count;
  let offset = 84;
  const index = new Map();
  const verts = [];
  const faces = [];
  const seen = new Set();
  const snap = (n) => Math.round(n / step) * step;
  const idOf = (p) => {
    const key = `${snap(p[0]).toFixed(3)},${snap(p[1]).toFixed(3)},${snap(p[2]).toFixed(3)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length;
      verts.push([snap(p[0]), snap(p[1]), snap(p[2])]);
      index.set(key, id);
    }
    return id;
  };
  while (left > 0) {
    const n = Math.min(left, chunk);
    fs.readSync(fd, buf, 0, n * triSize, offset);
    for (let i = 0; i < n; i++) {
      const ids = [];
      for (let v = 0; v < 3; v++) {
        const o = i * triSize + 12 + v * 12;
        ids.push(idOf([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]));
      }
      if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
      const key = [...ids].sort((a, b) => a - b).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(ids);
    }
    offset += n * triSize;
    left -= n;
  }
  fs.closeSync(fd);
  return faces.map((ids) => ids.map((id) => verts[id]));
}

function centerPlate(triangles) {
  let tris = triangles.map((tri) => tri.map((p) => p.slice()));
  const facing = faceUp(tris);
  if (facing.down > facing.up) tris = tris.map(([a, b, c]) => [a, c, b]);
  const all = [];
  eachVert(tris, (p) => all.push(p));
  const box = boundsOf(all);
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  const y0 = box.min[1];
  tris = tris.map((tri) => tri.map((p) => [p[0] - cx, p[1] - y0, p[2] - cz]));
  return {
    triangles: tris,
    width: box.max[0] - box.min[0],
    depth: box.max[2] - box.min[2],
    height: box.max[1] - box.min[1],
    minY: 0,
  };
}

function summarize(name, fitted) {
  const point = fitted.maxZ >= fitted.maxX ? "z" : "x";
  console.log(
    name,
    "height",
    fitted.height.toFixed(3),
    "maxX",
    fitted.maxX.toFixed(3),
    "maxZ",
    fitted.maxZ.toFixed(3),
    "minY",
    fitted.minY.toFixed(4),
    "longer",
    point
  );
  if (fitted.maxZ < fitted.maxX) {
    throw new Error(`${name} is wider than it is pointy after alignment`);
  }
  if (Math.abs(fitted.minY) > 1e-4) throw new Error(`${name} bottom is not on y=0`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const plate = centerPlate(readFoundationPlate());
  console.log(
    "foundation",
    "width",
    plate.width.toFixed(2),
    "depth",
    plate.depth.toFixed(2),
    "height",
    plate.height.toFixed(2)
  );
  const plateWrote = await weldAndWrite(path.join(OUT, "foundation.obj"), plate.triangles);
  console.log(" wrote foundation", plateWrote);
  const metrics = {
    foundation: {
      width: plate.width,
      depth: plate.depth,
      height: plate.height,
      verts: plateWrote.verts,
      faces: plateWrote.faces,
    },
  };
  for (const name of ["liquid", "height"]) {
    const source = name === "liquid" ? "Liquid-Tile.obj" : "Single-Hex.obj";
    const fitted = normalizeTriangles(readObjTriangles(path.join(SRC, source)));
    summarize(name, fitted);
    const wrote = await weldAndWrite(path.join(OUT, `${name}.obj`), fitted.triangles);
    metrics[name] = {
      height: fitted.height,
      maxX: fitted.maxX,
      maxZ: fitted.maxZ,
      verts: wrote.verts,
      faces: wrote.faces,
    };
    console.log(" wrote", name, wrote);
  }
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("prep-board.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
