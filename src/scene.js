import * as THREE from "three";
import { DIRS, HEX_SIZE, hexToWorld, key } from "../shared/hex.js";
import { foundationPose } from "../shared/boardFit.js";
import { loadBoardModels } from "./boardModels.js";
import { layoutBoard, makeTile, tileDepth, useBoardModels } from "./meshes.js";
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
    this.tableSpec = [];
    this.table = null;
    this.tableCenter = null;
    this.tableYaw = 0;
    this.handView = false;
    this.cardTextures = new Map();
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
    const dock = document.getElementById("dock");
    if (dock && typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => this.resize()).observe(dock);
    }
    this.modelsReady = false;
    loadBoardModels()
      .then((models) => {
        this.models = models;
        useBoardModels(models);
        this.modelsReady = true;
        if (this.state) {
          this.rebuild(this.state);
          this.syncShips(this.state);
          this.syncBombs(this.state);
        } else {
          this.buildLobby();
        }
      })
      .catch((err) => console.error(err));
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
    this.look.set(0, 0, 0);
    this.target.copy(this.look);
    this.spherical = { theta: 0.55, phi: 0.98, r: 16 };
    if (!this.models?.foundation) return;
    layoutBoard([{ q: 0, r: 0, terrain: "open", elevation: 0 }]);
    this.addFoundations([{ q: 0, r: 0 }]);
    const a = this.addShipMesh("demo-a", { color: "#ffb020", size: "small", q: 0, r: 0, facing: 0, shield: 2, shieldMax: 2, hullHp: 3, hullMax: 3, name: "" });
    const b = this.addShipMesh("demo-b", { color: "#3ee0ff", size: "medium", q: 1, r: -1, facing: 3, shield: 3, shieldMax: 3, hullHp: 4, hullMax: 4, name: "" });
    a.userData.bob = true;
    b.userData.bob = true;
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
    this.table = null;
    this.tableCenter = null;
    this.marks = null;
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

  addFoundations(origins) {
    if (!this.models?.foundation) return;
    const pose = foundationPose();
    const plates = origins?.length ? origins : [{ q: 0, r: 0 }];
    this.foundationOrigins = plates;
    for (const origin of plates) {
      const { x, z } = hexToWorld(origin.q || 0, origin.r || 0);
      const base = new THREE.Mesh(this.models.foundation, this.models.foundationMat);
      base.rotation.y = pose.yaw;
      base.scale.setScalar(pose.scale);
      base.position.set(pose.x + x, 0, pose.z + z);
      base.receiveShadow = true;
      base.castShadow = false;
      base.raycast = () => {};
      base.userData.kind = "foundation";
      if (this.models.foundationTop && this.models.spaceTopMat) {
        const top = new THREE.Mesh(this.models.foundationTop, this.spaceMaterial(origin, plates));
        top.raycast = () => {};
        top.castShadow = false;
        base.add(top);
      }
      this.scene.add(base);
    }
  }

  spaceMaterial(origin, plates) {
    const base = this.models.spaceTopMat;
    if (!plates || plates.length < 2) return base;
    const map = base.map.clone();
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.center.set(0.5, 0.5);
    map.rotation = purpleInwardRotation(origin, plates);
    map.needsUpdate = true;
    const mat = base.clone();
    mat.map = map;
    return mat;
  }

  rebuild(state) {
    this.clearBoard();
    if (this.models) layoutBoard(state.hexes);
    this.addFoundations(state.foundations);
    for (const hex of state.hexes || []) this.addHex(hex);
    let max = 1;
    for (const hex of state.hexes || []) {
      const { x, z } = hexToWorld(hex.q, hex.r);
      max = Math.max(max, Math.hypot(x, z));
    }
    if (this.ground) this.ground.scale.setScalar(Math.max(1, (max + 12) / 18));
    if (this.scene.fog) {
      this.scene.fog.near = Math.max(28, max);
      this.scene.fog.far = Math.max(70, max * 5);
    }
    const reserve = this.isMobile() ? 0 : 396;
    const fit = reserve ? window.innerWidth / Math.max(520, window.innerWidth - reserve) : 1;
    this.spherical.r = (this.isMobile() ? max * 1.55 + 6 : max * 1.35 + 8) * fit;
    this.look.set(0, 0, 0);
    this.target.copy(this.look);
    this.resize();
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
      this.drawTable();
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
      mesh.visible = !ship.cloaked;
      paintBar(mesh, ship);
    }
    for (const [id, mesh] of this.ships) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.ships.delete(id);
      }
    }
    this.drawMarks();
  }

  setMarks(spec) {
    this.markSpec = spec || null;
    this.drawMarks();
  }

  drawMarks() {
    if (this.marks) {
      this.scene.remove(this.marks);
      this.marks = null;
    }
    const spec = this.markSpec;
    if (!spec) return;
    const group = new THREE.Group();
    const add = (shipId, kind) => {
      const ship = this.ships.get(shipId);
      if (!ship) return;
      const mark = attackMark(kind);
      mark.position.copy(ship.position);
      mark.userData.baseY = ship.position.y;
      group.add(mark);
    };
    if (spec.selected) add(spec.selected, "selected");
    if (spec.shooter) add(spec.shooter, "shooter");
    if (spec.target && spec.target !== spec.shooter) add(spec.target, "target");
    group.traverse((obj) => {
      obj.raycast = () => {};
    });
    this.marks = group;
    this.scene.add(group);
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

  setTable(cards) {
    this.tableSpec = cards || [];
    this.drawTable();
  }

  drawTable() {
    if (this.table) {
      this.scene.remove(this.table);
      this.table = null;
    }
    const cards = this.tableSpec || [];
    if (!cards.length) return;
    const spots = [];
    for (const card of cards) {
      const ship = this.state?.ships?.find((s) => s.id === card.shipId);
      if (!ship) continue;
      spots.push(hexToWorld(ship.q, ship.r));
    }
    const ships = cards.filter((card) => card.row === "ship");
    const gear = cards.filter((card) => card.row === "gear");
    const lined = ships.length && gear.length ? [] : cards.filter((card) => card.row !== "ship" && card.row !== "gear");
    const { center, yaw } = this.tablePose(spots, ships.length && gear.length ? 2.15 : 1.02);
    const group = new THREE.Group();
    group.position.copy(center);
    group.position.y = 0.46;
    group.rotation.y = yaw;
    group.userData.kind = "table";
    const placeRow = (list, z, gap) => {
      const widths = list.map((card) => gap || (card.wide ? 2.05 : 1.45));
      const total = widths.reduce((sum, width) => sum + width, 0);
      let cursor = -total / 2;
      list.forEach((card, index) => {
        const width = widths[index];
        cursor += width;
        this.addTableCard(group, card, cursor - width / 2, z);
      });
    };
    if (ships.length && gear.length) {
      placeRow(ships, -1.2, 2.8);
      placeRow(gear, 1.2, 0);
    } else {
      placeRow(lined.length ? lined : cards, 0, 2.8);
    }
    group.traverse((obj) => {
      obj.raycast = () => {};
    });
    this.table = group;
    this.tableCenter = center;
    this.tableYaw = yaw;
    this.scene.add(group);
    if (this.handView) this.target.copy(center);
  }

  addTableCard(group, card, x, z) {
    const wide = !!card.wide;
    const width = wide ? 1.68 : 1.2;
    const height = wide ? 1.18 : 1.68;
    const slot = new THREE.Group();
    slot.position.set(x, card.focus ? 0.08 : 0, z);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.cardMaterial(card));
    plane.rotation.x = -Math.PI / 2;
    if (card.facedown) plane.rotation.z = Math.PI;
    plane.position.y = 0.02;
    if (card.spot) {
      const [left, top] = card.spot;
      const mark = new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.044, width * 0.044, 0.04, 20),
        new THREE.MeshBasicMaterial({ color: "#e0a020" })
      );
      mark.rotation.x = Math.PI / 2;
      mark.position.set((left / 100 - 0.5) * width, (0.5 - top / 100) * height, 0.04);
      plane.add(mark);
    }
    slot.add(plane);
    if (card.color && !card.facedown) {
      const token = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.05, 18),
        new THREE.MeshBasicMaterial({ color: card.color })
      );
      token.position.set(width * 0.32, 0.08, height * 0.34);
      slot.add(token);
    }
    const turns = Math.max(0, card.turn || 0);
    for (let i = 0; i < turns; i++) {
      const pip = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.16, 3),
        new THREE.MeshBasicMaterial({ color: card.turnDir === "left" ? "#7ec8ff" : "#ffb020" })
      );
      pip.rotation.x = Math.PI;
      pip.position.set(-width * 0.35 + i * 0.18, 0.12, -height * 0.4);
      slot.add(pip);
    }
    if (card.overdrive) {
      const od = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14),
        new THREE.MeshBasicMaterial({ color: "#ff5a4e" })
      );
      od.position.set(-width * 0.32, 0.08, height * 0.34);
      slot.add(od);
    }
    const label = makeText(card.name || "", card.focus ? "#ffb020" : "#d7e7ff");
    label.position.set(0, 0.2, height * 0.5 + 0.2);
    slot.add(label);
    group.add(slot);
  }

  cardMaterial(card) {
    if (card.facedown || !card.art) return new THREE.MeshBasicMaterial({ color: "#1a1208", side: THREE.DoubleSide });
    let map = this.cardTextures.get(card.art);
    if (!map) {
      map = new THREE.TextureLoader().load(card.art);
      map.colorSpace = THREE.SRGBColorSpace;
      this.cardTextures.set(card.art, map);
    }
    return new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
  }

  toggleHand() {
    this.handView = !this.handView;
    if (!this.handView) {
      if (this.savedView) {
        this.spherical.theta = this.savedView.theta;
        this.spherical.phi = this.savedView.phi;
        this.spherical.r = this.savedView.r;
        this.target.copy(this.savedView.look);
      }
      return false;
    }
    if (!this.tableCenter) {
      this.handView = false;
      return null;
    }
    this.savedView = {
      theta: this.spherical.theta,
      phi: this.spherical.phi,
      r: this.spherical.r,
      look: this.target.clone(),
    };
    this.target.copy(this.tableCenter);
    this.spherical.theta = this.tableYaw;
    this.spherical.phi = 0.62;
    this.spherical.r = 7.2;
    return true;
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
      else if (ev.type === "gyro" || ev.type === "knock") await this.slide(ev.shipId, ev.q, ev.r);
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
    mesh.rotation.y = facingYaw(ev.endFacing ?? ev.facing ?? 0);
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
      this.spherical.r = clamp(this.spherical.r + e.deltaY * 0.01, 8, 80);
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

  playfieldReserve() {
    if (this.isMobile() || !this.state) return 0;
    const dock = document.getElementById("dock");
    if (!dock || dock.classList.contains("collapsed")) return 0;
    const box = dock.getBoundingClientRect();
    if (box.width > 40 && box.height > 40) return Math.ceil(box.width + 16);
    return 396;
  }

  foundationFootprint() {
    const geo = this.models?.foundation;
    const origins = this.foundationOrigins?.length ? this.foundationOrigins : [{ q: 0, r: 0 }];
    if (!geo) return { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
    if (!geo.boundingBox) geo.computeBoundingBox();
    const pose = foundationPose();
    const { min, max } = geo.boundingBox;
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const origin of origins) {
      const { x, z } = hexToWorld(origin.q || 0, origin.r || 0);
      const cx = pose.x + x;
      const cz = pose.z + z;
      for (const sx of [min.x, max.x]) {
        for (const sz of [min.z, max.z]) {
          const lx = sx * pose.scale;
          const lz = sz * pose.scale;
          const wx = cx + lx * c + lz * s;
          const wz = cz - lx * s + lz * c;
          minX = Math.min(minX, wx);
          maxX = Math.max(maxX, wx);
          minZ = Math.min(minZ, wz);
          maxZ = Math.max(maxZ, wz);
        }
      }
    }
    return { minX, maxX, minZ, maxZ };
  }

  plateCorners() {
    const geo = this.models?.foundation;
    const origins = this.foundationOrigins?.length ? this.foundationOrigins : [{ q: 0, r: 0 }];
    if (!geo) return [{ x: -8, z: -8 }, { x: 8, z: -8 }, { x: -8, z: 8 }, { x: 8, z: 8 }];
    if (!geo.boundingBox) geo.computeBoundingBox();
    const pose = foundationPose();
    const { min, max } = geo.boundingBox;
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    const corners = [];
    for (const origin of origins) {
      const { x, z } = hexToWorld(origin.q || 0, origin.r || 0);
      const cx = pose.x + x;
      const cz = pose.z + z;
      for (const sx of [min.x, max.x]) {
        for (const sz of [min.z, max.z]) {
          const lx = sx * pose.scale;
          const lz = sz * pose.scale;
          corners.push({
            x: cx + lx * c + lz * s,
            z: cz - lx * s + lz * c,
          });
        }
      }
    }
    return corners;
  }

  tablePose(spots, pad = 1.02) {
    const mid = spots.length
      ? spots.reduce((sum, spot) => ({ x: sum.x + spot.x, z: sum.z + spot.z }), { x: 0, z: 0 })
      : { x: 0, z: 8 };
    if (spots.length) {
      mid.x /= spots.length;
      mid.z /= spots.length;
    }
    const corners = this.plateCorners();
    let cx = 0;
    let cz = 0;
    for (const corner of corners) {
      cx += corner.x;
      cz += corner.z;
    }
    cx /= corners.length;
    cz /= corners.length;
    let dx = mid.x - cx;
    let dz = mid.z - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) {
      dx = 0;
      dz = 1;
    } else {
      dx /= len;
      dz /= len;
    }
    const yaw = foundationPose().yaw;
    const normals = [
      [Math.sin(yaw), Math.cos(yaw)],
      [-Math.sin(yaw), -Math.cos(yaw)],
      [Math.cos(yaw), -Math.sin(yaw)],
      [-Math.cos(yaw), Math.sin(yaw)],
    ];
    let nx = normals[0][0];
    let nz = normals[0][1];
    let best = -Infinity;
    for (const [x, z] of normals) {
      const dot = x * dx + z * dz;
      if (dot > best) {
        best = dot;
        nx = x;
        nz = z;
      }
    }
    let support = 0;
    for (const corner of corners) {
      support = Math.max(support, (corner.x - cx) * nx + (corner.z - cz) * nz);
    }
    const t = support + pad;
    return {
      center: new THREE.Vector3(cx + nx * t, 0, cz + nz * t),
      yaw: Math.atan2(nx, nz),
    };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const reserve = this.playfieldReserve();
    if (reserve) this.camera.setViewOffset(w + reserve, h, reserve, 0, w, h);
    else this.camera.clearViewOffset();
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
    if (this.marks) {
      for (const mark of this.marks.children) {
        const bob = mark.userData.baseY + Math.sin(t * 3 + (mark.userData.kind === "target" ? 1 : 0)) * 0.05;
        mark.position.y = bob;
      }
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

function purpleInwardRotation(origin, plates) {
  let cx = 0;
  let cz = 0;
  for (const plate of plates) {
    const spot = hexToWorld(plate.q || 0, plate.r || 0);
    cx += spot.x;
    cz += spot.z;
  }
  cx /= plates.length;
  cz /= plates.length;
  const here = hexToWorld(origin.q || 0, origin.r || 0);
  const inward = Math.atan2(cx - here.x, cz - here.z);
  const yaw = foundationPose().yaw;
  const lx = -1;
  const lz = -1;
  const wx = lx * Math.cos(yaw) + lz * Math.sin(yaw);
  const wz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
  return inward - Math.atan2(wx, wz);
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
  sprite.scale.set(0.9, 0.34, 1);
  sprite.raycast = () => {};
  return sprite;
}

function paintBar(mesh, ship) {
  const bar = mesh.userData.bar;
  if (!bar) return;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 128, 48);
  pips(g, 4, 2, ship.shield, ship.shieldMax, "#3ee0ff");
  pips(g, 4, 16, ship.armor || 0, ship.armorMax || 0, "#d5dbe6");
  pips(g, 4, 30, ship.hullHp, ship.hullMax, "#ffb020");
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

function attackMark(kind) {
  const group = new THREE.Group();
  const color = kind === "target" ? "#ff5a4e" : "#ffb020";
  const onDeck = kind !== "target";
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(onDeck ? 0.62 : 0.46, onDeck ? 0.8 : 0.62, onDeck ? 6 : 28),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = onDeck ? 0.06 : 1.05;
  group.add(ring);
  if (kind === "target") {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 8), new THREE.MeshBasicMaterial({ color }));
    tip.rotation.x = Math.PI;
    tip.position.y = 0.82;
    group.add(tip);
  }
  const names = { shooter: "Firing", selected: "Selected", target: "Target" };
  const label = makeText(names[kind] || "", color);
  label.position.y = 1.32;
  group.add(label);
  group.userData.kind = kind;
  group.userData.baseY = 0;
  return group;
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
