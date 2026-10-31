import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { HEX_SIZE, hexRound, hexToWorld, key } from "../shared/hex.js";
import {
  FOUNDATION_FLOOR_Y,
  FOUNDATION_PITCH,
  FOUNDATION_RIM_Y,
  foundationPose,
} from "../shared/boardFit.js";

export const TOP_NY = 0.5;
export const LIQUID_TOP = 0.75;
export const HEIGHT_TOP = 0.78;
export const FOUNDATION_TOP = 0.72;

/**
 * Horizontal faces in the upper part of a mesh.
 * UVs put the image's top toward local -z, which is the far side when the
 * camera sits on +z. `repeat` tiles in model units (one grass copy per hex).
 */
export function topCapGeometry(geometry, yFraction, { repeat = 0 } = {}) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const vertCount = index ? index.count : pos.count;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    maxY = Math.max(maxY, pos.getY(i));
    minX = Math.min(minX, pos.getX(i));
    maxX = Math.max(maxX, pos.getX(i));
    minZ = Math.min(minZ, pos.getZ(i));
    maxZ = Math.max(maxZ, pos.getZ(i));
  }
  const yMin = maxY * yFraction;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanZ = Math.max(1e-6, maxZ - minZ);
  const positions = [];
  const uvs = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const at = (slot, target) => {
    const vi = index ? index.getX(slot) : slot;
    return target.fromBufferAttribute(pos, vi);
  };
  for (let i = 0; i < vertCount; i += 3) {
    at(i, a);
    at(i + 1, b);
    at(i + 2, c);
    const y = (a.y + b.y + c.y) / 3;
    if (y < yMin) continue;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    fn.crossVectors(ab, ac);
    const len = fn.length() || 1;
    if (Math.abs(fn.y) / len < TOP_NY) continue;
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      if (repeat) {
        uvs.push(p.x / repeat, -p.z / repeat);
      } else {
        uvs.push((p.x - minX) / spanX, (maxZ - p.z) / spanZ);
      }
    }
  }
  const cap = new THREE.BufferGeometry();
  cap.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  cap.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  cap.computeVertexNormals();
  return cap;
}

const FLOOR_TOP = (FOUNDATION_FLOOR_Y + FOUNDATION_RIM_Y) / 2;

function modelPointToHex(x, z, origin) {
  const pose = foundationPose();
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const base = hexToWorld(origin?.q || 0, origin?.r || 0);
  const wx = pose.x + base.x + (x * cos + z * sin) * pose.scale;
  const wz = pose.z + base.z + (-x * sin + z * cos) * pose.scale;
  const r = wz / (HEX_SIZE * 1.5);
  const q = wx / (HEX_SIZE * Math.sqrt(3)) - r / 2;
  return hexRound(q, r);
}

/**
 * Drop the flat hex pad under a water, crystal, or hill tile. The rim around
 * the socket stays. The shared source geometry is left alone.
 */
export function withoutTileFloors(geometry, origin, tiledKeys) {
  if (!geometry || !tiledKeys?.size) return geometry;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const uv = geometry.attributes.uv;
  const count = index ? index.count : pos.count;
  const positions = [];
  const uvs = [];
  const read = (slot) => {
    const vi = index ? index.getX(slot) : slot;
    return [
      pos.getX(vi),
      pos.getY(vi),
      pos.getZ(vi),
      uv ? uv.getX(vi) : 0,
      uv ? uv.getY(vi) : 0,
    ];
  };
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const a = read(i);
    const b = read(i + 1);
    const c = read(i + 2);
    const y = (a[1] + b[1] + c[1]) / 3;
    ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    fn.crossVectors(ab, ac);
    const len = fn.length() || 1;
    const flat = Math.abs(fn.y) / len >= TOP_NY;
    if (flat && y >= FOUNDATION_FLOOR_Y - 0.45 && y < FLOOR_TOP) {
      const hex = modelPointToHex((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3, origin);
      if (tiledKeys.has(key(hex.q, hex.r))) continue;
    }
    for (const v of [a, b, c]) {
      positions.push(v[0], v[1], v[2]);
      if (uv) uvs.push(v[3], v[4]);
    }
  }
  const next = new THREE.BufferGeometry();
  next.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (uv) next.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  next.computeVertexNormals();
  return next;
}

function photoMaterial(map) {
  return new THREE.MeshBasicMaterial({
    map,
    color: "#ffffff",
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function loadTexture(url, repeat) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        if (repeat) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

function firstGeometry(root) {
  let geo = null;
  root.traverse((obj) => {
    if (!geo && obj.isMesh && obj.geometry) geo = obj.geometry;
  });
  if (!geo) throw new Error("Board model has no mesh");
  geo.computeVertexNormals();
  return geo;
}

async function loadObj(url) {
  const text = await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Missing ${url}`);
    return res.text();
  });
  return firstGeometry(new OBJLoader().parse(text));
}

export async function loadBoardModels() {
  const [foundation, liquid, height, metrics, waterMap, rockMap, crystalMap, grassMap] = await Promise.all([
    loadObj("/models/foundation.obj"),
    loadObj("/models/liquid.obj"),
    loadObj("/models/height.obj"),
    fetch("/models/metrics.json").then((res) => res.json()),
    loadTexture("/textures/water.jpg"),
    loadTexture("/textures/rocks.jpg"),
    loadTexture("/textures/crystal.jpg"),
    loadTexture("/textures/grass.jpg", true),
  ]); 
  const liquidMat = new THREE.MeshStandardMaterial({
    color: "#3ec8ea",
    roughness: 0.16,
    metalness: 0.06,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
  });
  const waterTopMat = photoMaterial(waterMap);
  const crystalTopMat = photoMaterial(crystalMap);
  waterTopMat.transparent = true;
  waterTopMat.opacity = 1;
  crystalTopMat.transparent = true;
  crystalTopMat.opacity = 1;
  return {
    foundation,
    liquid,
    height,
    foundationTop: topCapGeometry(foundation, FOUNDATION_TOP, { repeat: FOUNDATION_PITCH }),
    liquidTop: topCapGeometry(liquid, LIQUID_TOP),
    heightTop: topCapGeometry(height, HEIGHT_TOP),
    foundationMat: new THREE.MeshStandardMaterial({
      color: "#6fbf63",
      roughness: 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    grassTopMat: photoMaterial(grassMap),
    liquidMat,
    waterTopMat,
    crystalTopMat,
    heightMat: new THREE.MeshStandardMaterial({
      color: "#a97449",
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    rockTopMat: photoMaterial(rockMap),
    foundationSize: {
      width: metrics.foundation.width,
      depth: metrics.foundation.depth,
      height: metrics.foundation.height,
    },
    liquidHeight: metrics.liquid.height,
    heightHeight: metrics.height.height,
    pieceMaxX: Math.max(metrics.liquid.maxX, metrics.height.maxX),
  };
}
