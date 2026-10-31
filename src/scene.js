import * as THREE from "three";
import { DIRS, HEX_SIZE, hexToWorld, key } from "../shared/hex.js";
import { makeTile, tileDepth } from "./meshes.js";
import { tween } from "./tweens.js";
import { describeHex, hideHexTip, showHexTip } from "./hexTip.js";

const UP = new THREE.Vector3(0, 1, 0);

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = null;
    this.localId = null;
    this.hexes = new Map();
    this.ships = new Map();
    this.bombs = new Map();
    this.preview = [];
    this.lastPreview = [];
    this.queue = Promise.resolve();
    this.target = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.spherical = { theta: 0.6, phi: 0.92, r: 18 };
    this.pointers = new Map();
    this.pinch0 = 0;
    this.pressTimer = 0;
    this.onHex = null;
    this.onShip = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x070b14, 1);
    this.renderer.shadowMap.enabled = !this.isMobile();
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x070b14, 28, 70);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();

    this.buildLights();
    this.buildGround();
    this.buildStars();
    this.bindInput();
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    window.addEventListener("resize", () => this.resize());
    this.buildLobby();
  }

  isMobile() {
    return window.matchMedia("(max-width: 800px)").matches;
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9ecbff, 0x1a2438, 0.85));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.35);
    sun.position.set(12, 18, 8);
    sun.castShadow = this.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 60;
    this.scene.add(sun);
    this.sun = sun;
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 48),
      new THREE.MeshStandardMaterial({ color: "#10182a", roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.ground = ground;
    this.scene.add(ground);
  }

  buildStars() {
    const count = 280;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 1] = 6 + Math.random() * 28;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xd7e7ff, size: 0.06, transparent: true, opacity: 0.85 })
    );
    this.scene.add(this.stars);
  }

  buildLobby() {
    this.clearBoard();
    const demo = [
      { q: 0, r: 0, terrain: "void", elevation: 0, tint: "#2a4170" },
      { q: 1, r: 0, terrain: "void", elevation: 0, tint: "#1b2c4d" },
      { q: 0, r: -1, terrain: "void", elevation: 0, tint: "#152238" },
      { q: -1, r: 0, terrain: "void", elevation: 0, tint: "#1b2c4d" },
      { q: -1, r: 1, terrain: "void", elevation: 0, tint: "#152238" },
      { q: 0, r: 1, terrain: "void", elevation: 0, tint: "#1b2c4d" },
      { q: 1, r: -1, terrain: "void", elevation: 0, tint: "#152238" },
    ];
    for (const hex of demo) this.addHex(hex);
    const a = this.addShipMesh("demo-a", { color: "#ffb020", size: "small", q: 0, r: 0, facing: 0, shield: 3, shieldMax: 3, hullHp: 3, hullMax: 3, name: "" });
    const b = this.addShipMesh("demo-b", { color: "#3ee0ff", size: "medium", q: 1, r: -1, facing: 3, shield: 4, shieldMax: 4, hullHp: 5, hullMax: 5, name: "" });
    a.userData.bob = true;
    b.userData.bob = true;
    this.look.set(0, 0, 0);
    this.target.copy(this.look);
    this.spherical = { theta: 0.4, phi: 0.95, r: 8 };
  }

  clearBoard() {
    const keep = new Set([this.ground, this.sun, this.stars].filter(Boolean));
    for (const child of [...this.scene.children]) {
      if (keep.has(child) || child.isLight) continue;
      this.scene.remove(child);
    }
    this.hexes.clear();
    this.ships.clear();
    this.bombs.clear();
    this.preview = [];
  }

  addHex(hex) {
    const tile = makeTile(hex);
    const { x, z } = hexToWorld(hex.q, hex.r);
    tile.position.set(x, 0, z);
    const size = HEX_SIZE * 0.96;
    const y = tileDepth(hex) + 0.03;
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 180) * (60 * (i % 6) - 30);
      pts.push(new THREE.Vector3(size * Math.cos(angle), y, -size * Math.sin(angle)));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x7ea2d6, transparent: true, opacity: 0.55 })
    );
    line.raycast = () => {};
    tile.add(line);
    this.scene.add(tile);
    this.hexes.set(key(hex.q, hex.r), { mesh: tile, hex });
  }

  rebuild(state) {
    this.clearBoard();
    for (const hex of state.hexes || []) this.addHex(hex);
    let max = 1;
    for (const hex of state.hexes || []) {
      const { x, z } = hexToWorld(hex.q, hex.r);
      max = Math.max(max, Math.hypot(x, z));
    }
    if (this.ground) this.ground.scale.setScalar(Math.max(1, (max + 8) / 18));
    this.spherical.r = this.isMobile() ? max * 1.45 + 4 : max * 1.2 + 5;
    // The order panel covers the right side on a desktop, so look a little
    // toward +X and the arena sits in the open part of the screen.
    const bias = this.isMobile() ? 0 : Math.min(4.5, max * 0.35);
    this.look.set(bias, 0, 0);
    this.target.copy(this.look);
  }

  apply(state, events = []) {
    if (!state) return;
    const run = this.queue.then(async () => {
      if (!this.state || this.hexes.size !== (state.hexes || []).length) this.rebuild(state);
      this.state = state;
      if (events?.length) await this.playEvents(events, state);
      this.syncShips(state);
      this.syncBombs(state);
      this.drawPreview();
    });
    this.queue = run.catch((err) => console.error(err));
  }

  syncShips(state) {
    const seen = new Set();
    const piles = new Map();
    for (const ship of state.ships || []) {
      const k = key(ship.q, ship.r);
      if (!piles.has(k)) piles.set(k, []);
      piles.get(k).push(ship.id);
    }
    for (const ship of state.ships || []) {
      seen.add(ship.id);
      const pilot = state.players.find((p) => p.id === ship.playerId);
      const color = pilot?.color?.hex || "#d7e7ff";
      let mesh = this.ships.get(ship.id);
      if (!mesh) mesh = this.addShipMesh(ship.id, { ...ship, color });
      mesh.userData.shipId = ship.id;
      mesh.userData.q = ship.q;
      mesh.userData.r = ship.r;
      mesh.userData.color = color;
      place(mesh, ship.q, ship.r, 0.18);
      const mates = piles.get(key(ship.q, ship.r));
      if (mates.length > 1) {
        const i = mates.indexOf(ship.id);
        mesh.position.x += (i - (mates.length - 1) / 2) * 0.38;
      }
      mesh.rotation.y = facingYaw(ship.facing);
      mesh.visible = true;
      paintBar(mesh, ship);
    }
    for (const [id, mesh] of this.ships) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.ships.delete(id);
      }
    }
  }

  addShipMesh(id, ship) {
    const group = new THREE.Group();
    const scale = ship.size === "large" ? 1.2 : ship.size === "medium" ? 0.92 : 0.7;
    const mat = new THREE.MeshStandardMaterial({
      color: ship.color,
      emissive: ship.color,
      emissiveIntensity: 0.35,
      roughness: 0.38,
      metalness: 0.55,
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.78, 4), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.castShadow = true;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.22), mat);
    wing.position.set(0, 0.02, -0.08);
    group.add(nose, wing);
    group.scale.setScalar(scale);
    const bar = makeBar();
    bar.position.y = 0.85;
    group.add(bar);
    group.userData = { kind: "ship", shipId: id, q: ship.q, r: ship.r, bar, color: ship.color };
    place(group, ship.q, ship.r, 0.18);
    group.rotation.y = facingYaw(ship.facing || 0);
    this.scene.add(group);
    this.ships.set(id, group);
    if (ship.shieldMax) paintBar(group, ship);
    return group;
  }

  syncBombs(state) {
    const seen = new Set();
    for (const bomb of state.bombs || []) {
      seen.add(bomb.id);
      if (this.bombs.has(bomb.id)) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.42, 6),
        new THREE.MeshBasicMaterial({ color: 0xff5a4e, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = Math.PI / 6;
      place(ring, bomb.q, bomb.r, 0.08);
      ring.userData.spin = true;
      this.scene.add(ring);
      this.bombs.set(bomb.id, ring);
    }
    for (const [id, mesh] of this.bombs) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.bombs.delete(id);
    }
  }

  setPreview(paths) {
    this.lastPreview = paths || [];
    this.drawPreview();
  }

  drawPreview() {
    for (const line of this.preview) this.scene.remove(line);
    this.preview = [];
    for (const item of this.lastPreview || []) {
      if (!item.path || item.path.length < 2) continue;
      const pts = item.path.map((hex, index) => {
        const { x, z } = hexToWorld(hex.q, hex.r);
        return new THREE.Vector3(x, 0.4 + index * 0.02, z);
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: item.color || "#7ec8ff" })
      );
      line.raycast = () => {};
      this.scene.add(line);
      this.preview.push(line);
    }
  }

  async playEvents(events) {
    const pending = [...events];
    const moves = [];
    while (pending[0]?.type === "move") moves.push(pending.shift());
    await Promise.all(moves.map((ev) => this.animateMove(ev)));
    for (const ev of pending) {
      if (ev.type === "collide") await this.flash(ev.a, "#ff5a4e");
      else if (ev.type === "gyro") await this.slide(ev.shipId, ev.q, ev.r);
      else if (ev.type === "bomb") {
        this.floatText(ev.q, ev.r, "BOMB", "#ff5a4e");
        await wait(160);
      } else if (ev.type === "attack") {
        const ship = this.ships.get(ev.shipId);
        const target = this.ships.get(ev.targetId);
        if (ship && target) this.shotLine(ship.position, target.position, ev.quality === "miss" ? "#8aa0bd" : "#ffe14a");
        const label = ev.quality === "miss" ? "miss" : `${ev.quality} ${ev.damage}`;
        const mesh = this.ships.get(ev.targetId);
        if (mesh) this.floatText(mesh.userData.q, mesh.userData.r, label, ev.quality === "red" ? "#ff5a4e" : "#ffe14a");
        await wait(180);
      } else if (ev.type === "wreck") {
        const mesh = this.ships.get(ev.shipId);
        if (mesh) {
          const base = mesh.scale.x || 1;
          await tween({
            duration: 220,
            onUpdate: (u) => mesh.scale.setScalar(Math.max(0.05, base * (1 - u))),
          });
          mesh.visible = false;
        }
      }
    }
  }

  async animateMove(ev) {
    const mesh = this.ships.get(ev.shipId);
    if (!mesh || !ev.path?.length) return;
    mesh.rotation.y = facingYaw(ev.facing || 0);
    if (ev.cloaked && ev.card === "cloaked") {
      mesh.visible = false;
      const end = ev.path[ev.path.length - 1];
      place(mesh, end.q, end.r, 0.18);
      mesh.userData.q = end.q;
      mesh.userData.r = end.r;
      mesh.visible = true;
      return;
    }
    for (let i = 1; i < ev.path.length; i++) {
      const from = ev.path[i - 1];
      const to = ev.path[i];
      const a = hexToWorld(from.q, from.r);
      const b = hexToWorld(to.q, to.r);
      const y = 0.18 + tileDepth({ elevation: 0 });
      await tween({
        duration: 140,
        onUpdate: (u) => {
          mesh.position.set(a.x + (b.x - a.x) * u, y, a.z + (b.z - a.z) * u);
        },
      });
      mesh.userData.q = to.q;
      mesh.userData.r = to.r;
    }
  }

  async slide(id, q, r) {
    const mesh = this.ships.get(id);
    if (!mesh) return;
    const a = { x: mesh.position.x, z: mesh.position.z };
    const b = hexToWorld(q, r);
    const y = mesh.position.y;
    await tween({
      duration: 160,
      onUpdate: (u) => mesh.position.set(a.x + (b.x - a.x) * u, y, a.z + (b.z - a.z) * u),
    });
    mesh.userData.q = q;
    mesh.userData.r = r;
  }

  async flash(id, color) {
    const mesh = this.ships.get(id);
    if (!mesh) return;
    const body = mesh.children.find((c) => c.material?.emissive);
    const prev = body?.material.emissive.getHex();
    if (body) body.material.emissive.set(color);
    await wait(120);
    if (body && prev != null) body.material.emissive.setHex(prev);
  }

  shotLine(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      from.clone().setY(0.55),
      to.clone().setY(0.55),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    this.scene.add(line);
    setTimeout(() => this.scene.remove(line), 220);
  }

  floatText(q, r, text, color) {
    const sprite = makeText(text, color);
    place(sprite, q, r, 1.1);
    this.scene.add(sprite);
    const y0 = sprite.position.y;
    tween({
      duration: 700,
      onUpdate: (u) => {
        sprite.position.y = y0 + u * 0.7;
        sprite.material.opacity = 1 - u;
      },
      onDone: () => this.scene.remove(sprite),
    });
  }

  bindInput() {
    const el = this.canvas;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      const mouse = e.pointerType === "mouse";
      if (mouse && e.button !== 0 && e.button !== 2) return;
      const orbit = !mouse || e.button === 2;
      const pick = !mouse || e.button === 0;
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, orbit, pick, moved: false });
      if (pick) {
        clearTimeout(this.pressTimer);
        this.pressTimer = setTimeout(() => {
          const held = this.pointers.get(e.pointerId);
          if (!held || held.moved) return;
          const hex = this.hexAt(held.x, held.y);
          if (hex) showHexTip(describeHex(this.state, hex.q, hex.r), held.x, held.y);
        }, 700);
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener("pointermove", (e) => {
      const rec = this.pointers.get(e.pointerId);
      if (!rec) return;
      const dx = e.clientX - rec.x;
      const dy = e.clientY - rec.y;
      rec.x = e.clientX;
      rec.y = e.clientY;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0) {
          this.spherical.r = clamp(this.spherical.r * (this.pinch0 / d), 6, 40);
          this.pinch0 = d;
        }
        return;
      }
      if (Math.hypot(dx, dy) > 6) rec.moved = true;
      if (!rec.orbit) return;
      this.spherical.theta -= dx * 0.005;
      this.spherical.phi = clamp(this.spherical.phi - dy * 0.004, 0.35, 1.25);
    });
    const up = (e) => {
      clearTimeout(this.pressTimer);
      const rec = this.pointers.get(e.pointerId);
      if (rec?.pick && !rec.moved) this.pick(e.clientX, e.clientY);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch0 = 0;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", () => hideHexTip());
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.spherical.r = clamp(this.spherical.r + e.deltaY * 0.01, 6, 40);
    }, { passive: false });
  }

  pick(x, y) {
    const hit = this.objectAt(x, y);
    if (!hit) return;
    const ship = parentKind(hit, "ship");
    if (ship) {
      this.onShip?.(ship.userData.shipId, ship.userData.q, ship.userData.r);
      return;
    }
    const tile = parentKind(hit, "hex");
    if (tile) this.onHex?.(tile.userData.q, tile.userData.r);
  }

  hexAt(x, y) {
    const hit = this.objectAt(x, y);
    if (!hit) return null;
    const ship = parentKind(hit, "ship");
    if (ship) return { q: ship.userData.q, r: ship.userData.r };
    const tile = parentKind(hit, "hex");
    if (!tile) return null;
    return { q: tile.userData.q, r: tile.userData.r };
  }

  objectAt(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return null;
    this.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const stuff = [...this.hexes.values()].map((h) => h.mesh).concat([...this.ships.values()]);
    const hits = this.raycaster.intersectObjects(stuff, true);
    return hits[0]?.object || null;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    this.look.lerp(this.target, 0.08);
    if (!this.state) this.spherical.theta += 0.0012;
    const { theta, phi, r } = this.spherical;
    this.camera.position.set(
      this.look.x + r * Math.sin(phi) * Math.sin(theta),
      this.look.y + r * Math.cos(phi),
      this.look.z + r * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.up.copy(UP);
    this.camera.lookAt(this.look);
  }

  loop() {
    const t = this.clock.getElapsedTime();
    this.updateCamera();
    for (const mesh of this.ships.values()) {
      if (!mesh.userData.bob) continue;
      mesh.position.y = 0.22 + Math.sin(t * 2 + mesh.id) * 0.04;
    }
    for (const mesh of this.bombs.values()) {
      mesh.rotation.z += 0.01;
      mesh.position.y = 0.1 + Math.sin(t * 3) * 0.03;
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}

function place(obj, q, r, extra) {
  const { x, z } = hexToWorld(q, r);
  obj.position.set(x, tileDepth({ elevation: 0 }) + extra, z);
}

function facingYaw(facing) {
  const d = DIRS[((facing % 6) + 6) % 6];
  const w = hexToWorld(d.q, d.r);
  return Math.atan2(w.x, w.z);
}

function parentKind(obj, kind) {
  let cur = obj;
  while (cur) {
    if (cur.userData?.kind === kind) return cur;
    cur = cur.parent;
  }
  return null;
}

function makeBar() {
  const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.9, 0.22, 1);
  sprite.raycast = () => {};
  return sprite;
}

function paintBar(mesh, ship) {
  const bar = mesh.userData.bar;
  if (!bar) return;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 128, 32);
  pips(g, 4, 4, ship.shield, ship.shieldMax, "#3ee0ff");
  pips(g, 4, 18, ship.hullHp, ship.hullMax, "#ffb020");
  const tex = new THREE.CanvasTexture(c);
  if (bar.material.map) bar.material.map.dispose();
  bar.material.map = tex;
  bar.material.needsUpdate = true;
}

function pips(g, x, y, value, max, color) {
  const n = Math.max(max || 0, 0);
  for (let i = 0; i < n; i++) {
    g.fillStyle = i < value ? color : "rgba(255,255,255,0.18)";
    g.fillRect(x + i * 14, y, 10, 8);
  }
}

function makeText(text, color) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  g.font = "700 36px sans-serif";
  g.textAlign = "center";
  g.fillStyle = color;
  g.fillText(text, 128, 42);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.35, 1);
  return sprite;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
