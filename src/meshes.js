import * as THREE from "three";
import { HEX_SIZE } from "../shared/hex.js";
import { capScaleFor, foundationPose } from "../shared/boardFit.js";

let kit = null;

export function useBoardModels(models) {
  kit = models;
  if (!kit.pickerGeo) {
    const geo = new THREE.ExtrudeGeometry(hexShape(HEX_SIZE * 0.9), {
      depth: 0.04,
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    kit.pickerGeo = geo;
    kit.pickerMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  }
}

export function layoutBoard(hexes) {
  if (!kit || !hexes?.length) return null;
  const layout = foundationPose();
  kit.layout = layout;
  kit.capScale = capScaleFor(kit.pieceMaxX);
  kit.groundTop = kit.foundationSize.height * layout.scale;
  // Piece meshes are built with their base at local y=0. y=0 is the bottom
  // of the foundation, so the water and hills rest on that base.
  kit.grooveY = 0;
  kit.waterTop = kit.liquidHeight * kit.capScale;
  kit.hillTop = kit.heightHeight * kit.capScale;
  return layout;
}

export function hexShape(size = HEX_SIZE * 0.92) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = size * Math.cos(angle);
    const y = size * Math.sin(angle);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

export function tileDepth(hex) {
  if (kit?.groundTop) {
    if (hex.terrain === "water" || hex.pool) return kit.waterTop;
    if ((hex.elevation || 0) > 0) return kit.hillTop;
    return kit.groundTop;
  }
  if (hex.terrain === "water" || hex.pool || hex.elevation < 0) return 0.16;
  return 0.26 + Math.max(0, hex.elevation) * 0.42;
}

export function tileColor(hex) {
  if (hex.tint) return hex.tint;
  if (hex.terrain === "water" || hex.pool) return "#3db8d9";
  if (hex.terrain === "tree") return "#5aa34e";
  if (hex.elevation > 0) return "#a97449";
  return "#6fbf63";
}

export function makeTile(hex) {
  if (kit?.foundation) return makeModelTile(hex);
  return makePrismTile(hex);
}

function makeModelTile(hex) {
  const depth = tileDepth(hex);
  const group = new THREE.Group();
  group.userData = {
    kind: "hex",
    q: hex.q,
    r: hex.r,
    depth,
    terrain: hex.terrain || "open",
  };
  const picker = new THREE.Mesh(kit.pickerGeo, kit.pickerMat);
  picker.position.y = depth;
  group.add(picker);
  if (hex.terrain === "water" || hex.pool) {
    const water = new THREE.Mesh(kit.liquid, kit.liquidMat);
    water.scale.setScalar(kit.capScale);
    water.position.y = kit.grooveY;
    water.receiveShadow = true;
    water.renderOrder = 1;
    group.add(water);
    const topMat = hex.pool ? kit.crystalTopMat : kit.waterTopMat;
    const capMat = attachTop(water, kit.liquidTop, topMat, hex.pool);
    if (capMat) group.userData.crystalMat = capMat;
  } else if ((hex.elevation || 0) > 0) {
    const rise = new THREE.Mesh(kit.height, kit.heightMat);
    rise.scale.setScalar(kit.capScale);
    rise.position.y = kit.grooveY;
    rise.castShadow = true;
    rise.receiveShadow = true;
    rise.renderOrder = 1;
    group.add(rise);
    attachTop(rise, kit.heightTop, kit.rockTopMat, false);
  }
  if (hex.terrain === "tree") {
    const tree = makeTree();
    // Bite the trunk a hair into the rim so the base meets the plate.
    tree.position.y = depth - 0.015;
    group.add(tree);
  }
  return group;
}

function attachTop(body, geometry, material, ownMaterial) {
  if (!geometry || !material) return null;
  const mat = ownMaterial ? material.clone() : material;
  const cap = new THREE.Mesh(geometry, mat);
  cap.renderOrder = 2;
  cap.castShadow = false;
  cap.receiveShadow = false;
  cap.raycast = () => {};
  body.add(cap);
  return ownMaterial ? mat : null;
}

function makePrismTile(hex) {
  const depth = tileDepth(hex);
  const geo = new THREE.ExtrudeGeometry(hexShape(), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: tileColor(hex),
    roughness: hex.terrain === "water" || hex.pool ? 0.2 : 0.7,
    metalness: hex.terrain === "water" || hex.pool ? 0.15 : 0.02,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData = { kind: "hex", q: hex.q, r: hex.r, depth, terrain: hex.terrain || "open" };
  if (hex.terrain === "tree") {
    const tree = makeTree();
    tree.position.y = depth;
    mesh.add(tree);
  }
  if (hex.terrain === "water" || hex.pool) {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(HEX_SIZE * 0.72, 6),
      new THREE.MeshStandardMaterial({
        color: "#7fe7ff",
        transparent: true,
        opacity: 0.45,
        roughness: 0.15,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = Math.PI / 6;
    water.position.y = depth + 0.02;
    water.userData.water = true;
    mesh.add(water);
  }
  return mesh;
}

function makeTree() {
  const g = new THREE.Group();
  const trunkH = 0.34;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: "#8a5a32", flatShading: true })
  );
  // Cylinder is centered, so half the height puts the base on the parent's y.
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.38, 0.7, 7),
    new THREE.MeshStandardMaterial({ color: "#2f8f4a", flatShading: true })
  );
  leaf.position.y = 0.55;
  leaf.castShadow = true;
  const leaf2 = leaf.clone();
  leaf2.position.y = 0.82;
  leaf2.scale.setScalar(0.72);
  g.add(trunk, leaf, leaf2);
  return g;
}

export function makeBlorp(colorHex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.32,
    metalness: 0.04,
    emissive: colorHex,
    emissiveIntensity: 0.1,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 20), mat);
  body.scale.y = 0.82;
  body.castShadow = true;
  const eyeWhite = new THREE.MeshStandardMaterial({ color: "#fff" });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), eyeWhite);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.12, 0.14, 0.32);
  eyeR.position.set(0.12, 0.14, 0.32);
  const pupilMat = new THREE.MeshStandardMaterial({ color: "#1b2430" });
  const pL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupilMat);
  const pR = pL.clone();
  pL.position.set(0.015, -0.005, 0.06);
  pR.position.set(0.015, -0.005, 0.06);
  eyeL.add(pL);
  eyeR.add(pR);
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.018, 6, 10, Math.PI),
    new THREE.MeshStandardMaterial({ color: "#c4456a" })
  );
  smile.position.set(0, 0.02, 0.36);
  smile.rotation.set(Math.PI, 0, 0);
  const hat = makeTopHat();
  g.add(body, eyeL, eyeR, smile, hat);
  g.userData = { body, eyeL, eyeR, colorHex, kind: "blorp", hat, hatTop: hat.userData.top };
  return g;
}

function makeTopHat() {
  const hat = new THREE.Group();
  const felt = new THREE.MeshStandardMaterial({
    color: "#141414",
    roughness: 0.68,
    metalness: 0.04,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: "#0c0c0c",
    roughness: 0.4,
    metalness: 0.35,
  });
  const brimH = 0.03;
  const brimY = 0.3;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, brimH, 24), felt);
  brim.position.y = brimY;
  brim.castShadow = true;
  const crownH = 0.34;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, crownH, 20), felt);
  crown.position.y = brimY + brimH / 2 + crownH / 2;
  crown.castShadow = true;
  const bandH = 0.045;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, bandH, 20), bandMat);
  band.position.y = brimY + brimH / 2 + bandH / 2 + 0.006;
  band.castShadow = true;
  hat.add(brim, crown, band);
  hat.userData.top = crown.position.y + crownH / 2;
  return hat;
}

const FRUIT_FACES = {
  apple: "/textures/tokens/apple.png",
  banana: "/textures/tokens/banana.png",
  grapes: "/textures/tokens/grapes.png",
};

export function makeFruit(fruit) {
  const token = makeBoardToken(FRUIT_FACES[fruit?.type]);
  token.userData.fruitType = fruit?.type || "";
  return token;
}

/** Flat-topped octagon. `radius` is the distance to a vertex. */
function octagonShape(radius) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * (Math.PI / 4);
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function octagonPrism(radius, depth, material) {
  const geo = new THREE.ExtrudeGeometry(octagonShape(radius), {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Dashed stitch just inside the cream, one run of dashes per side. */
function stitchRing(radius, y) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.04, 0.004, 0.011);
  const mat = new THREE.MeshBasicMaterial({ color: "#6a4324" });
  const dash = 0.04;
  const gap = 0.02;
  for (let i = 0; i < 8; i++) {
    const a0 = Math.PI / 8 + i * (Math.PI / 4);
    const a1 = a0 + Math.PI / 4;
    const p0x = Math.cos(a0) * radius;
    const p0y = Math.sin(a0) * radius;
    const p1x = Math.cos(a1) * radius;
    const p1y = Math.sin(a1) * radius;
    const dx = p1x - p0x;
    const dy = p1y - p0y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const yaw = Math.atan2(uy, ux);
    let t = (len - Math.floor(len / (dash + gap)) * (dash + gap)) / 2;
    if (t < 0.008) t = gap * 0.5;
    while (t + dash <= len - 0.006) {
      const mx = p0x + ux * (t + dash / 2);
      const my = p0y + uy * (t + dash / 2);
      const mark = new THREE.Mesh(geo, mat);
      mark.position.set(mx, y, -my);
      mark.rotation.y = yaw;
      mark.castShadow = false;
      mark.receiveShadow = false;
      g.add(mark);
      t += dash + gap;
    }
  }
  return g;
}

let boardTokenTemplate = null;
let tokenIconGeo = null;
const tokenTextures = new Map();
const textureLoader = new THREE.TextureLoader();

function sharedIconGeo() {
  if (!tokenIconGeo) tokenIconGeo = new THREE.PlaneGeometry(1, 1);
  return tokenIconGeo;
}

/** Longest side of the picture, kept inside the stitch. */
const ICON_SPAN = 0.6;

function fitIcon(icon, tex) {
  const img = tex.image;
  if (!img?.width || !img.height) return;
  const aspect = img.width / img.height;
  if (aspect >= 1) icon.scale.set(ICON_SPAN, ICON_SPAN / aspect, 1);
  else icon.scale.set(ICON_SPAN * aspect, ICON_SPAN, 1);
}

function loadTokenTexture(url, onReady) {
  let entry = tokenTextures.get(url);
  if (!entry) {
    const listeners = new Set();
    const tex = textureLoader.load(url, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.needsUpdate = true;
      for (const fn of listeners) fn(loaded);
      listeners.clear();
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    entry = { tex, listeners };
    tokenTextures.set(url, entry);
  }
  if (onReady) {
    if (entry.tex.image?.width) onReady(entry.tex);
    else entry.listeners.add(onReady);
  }
  return entry.tex;
}

function addFacePicture(token, url) {
  if (!url || typeof document === "undefined") return;
  const icon = new THREE.Mesh(
    sharedIconGeo(),
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.04,
    })
  );
  icon.name = "icon";
  icon.rotation.x = -Math.PI / 2;
  icon.position.y = 0.052;
  icon.renderOrder = 3;
  icon.raycast = () => {};
  const apply = (tex) => {
    icon.material.map = tex;
    icon.material.needsUpdate = true;
    fitIcon(icon, tex);
  };
  const tex = loadTokenTexture(url, apply);
  if (tex.image?.width) apply(tex);
  token.add(icon);
}

function buildBoardToken() {
  const g = new THREE.Group();
  g.userData.kind = "board-token";
  const rim = octagonPrism(
    0.55,
    0.03,
    new THREE.MeshBasicMaterial({ color: "#5e3b1e" })
  );
  const gold = octagonPrism(
    0.52,
    0.012,
    new THREE.MeshBasicMaterial({ color: "#e9b53a" })
  );
  gold.position.y = 0.026;
  const face = octagonPrism(
    0.435,
    0.008,
    new THREE.MeshBasicMaterial({ color: "#fff7e8" })
  );
  face.position.y = 0.036;
  face.userData.role = "face";
  const stitch = stitchRing(0.4, 0.046);
  g.add(rim, gold, face, stitch);
  return g;
}

/**
 * Octagonal token. `faceUrl` is the picture drawn inside the stitch.
 */
export function makeBoardToken(faceUrl) {
  if (!boardTokenTemplate) boardTokenTemplate = buildBoardToken();
  const token = boardTokenTemplate.clone();
  addFacePicture(token, faceUrl);
  return token;
}

export function makeToken(color = "#e6b325") {
  const token = makeBoardToken("/textures/tokens/slime.png");
  token.userData.tint = color;
  return token;
}

export function makeHighlight() {
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  group.rotation.z = Math.PI / 6;
  const lay = (inner, outer, material, order, lift) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 6), material);
    ring.position.z = lift;
    ring.renderOrder = order;
    group.add(ring);
    return ring;
  };
  const black = new THREE.MeshBasicMaterial({
    color: "#111111",
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const white = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  lay(HEX_SIZE * 0.46, HEX_SIZE * 0.94, black, 2, 0.02);
  lay(HEX_SIZE * 0.56, HEX_SIZE * 0.84, white, 3, 0.04);
  group.userData.pulse = white;
  return group;
}
