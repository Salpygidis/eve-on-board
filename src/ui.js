import { NAMES } from "../shared/constants.js";
import {
  CATALOG,
  COLORS,
  MANEUVERS,
  MANEUVER_INFO,
  SHIPS,
  colorById,
  costLabel,
} from "../shared/catalog.js";
import { statLine, travelLimit, validateFleet, validateOrders } from "../shared/rules.js";
import { previewPath, suggestAttacks, suggestOrders } from "../shared/ai.js";

const $ = (id) => document.getElementById(id);

export const els = {
  name: $("name"),
  code: $("code"),
  spectator: $("spectator"),
  btnCreate: $("btn-create"),
  btnJoin: $("btn-join"),
  btnPractice: $("btn-practice"),
  btnHow: $("btn-how"),
  btnHelp: $("btn-help"),
  btnLeave: $("btn-leave"),
  btnCopy: $("btn-copy"),
  btnStart: $("btn-start"),
  btnAgain: $("btn-again"),
  btnBotsLess: $("btn-bots-less"),
  btnBotsMore: $("btn-bots-more"),
  botCount: $("bot-count"),
  botRow: $("bot-row"),
  waitCode: $("wait-code"),
  waitRole: $("wait-role"),
  waitList: $("wait-list"),
  hudCode: $("hud-code"),
  phaseText: $("phase-text"),
  roster: $("roster"),
  log: $("log"),
  dock: $("dock"),
  dockToggle: $("dock-toggle"),
  volume: $("volume"),
  btnMute: $("btn-mute"),
  modal: $("modal"),
  lobby: $("lobby"),
  waiting: $("waiting"),
  hud: $("hud"),
};

let hooks = {};
let formKey = "";
let draft = null;
let shownWin = false;
let viewSession = { isSpectator: true, playerId: "" };

export function bind(next) {
  hooks = next;
}

export function randomName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

export function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove("show"), 2200);
}

export function showScreen(name) {
  els.lobby.classList.toggle("hidden", name !== "lobby");
  els.waiting.classList.toggle("hidden", name !== "waiting");
  els.hud.classList.toggle("hidden", name !== "play");
}

export function renderLobbyList(lobby, youId) {
  els.waitCode.textContent = lobby.code;
  els.hudCode.textContent = lobby.code;
  const you = lobby.players.find((p) => p.id === youId);
  const host = you?.id === lobby.hostId;
  els.waitRole.textContent = you?.isSpectator ? "You are watching." : host ? "You are the host." : "Waiting for the host.";
  els.waitList.innerHTML = lobby.players
    .map((p) => `<li>${esc(p.name)}${p.isBot ? " · bot" : ""}${p.isSpectator ? " · spectator" : ""}${p.id === lobby.hostId ? " · host" : ""}</li>`)
    .join("");
  const bots = lobby.players.filter((p) => p.isBot).length;
  els.botCount.textContent = String(bots);
  els.botRow.classList.toggle("hidden", !host || lobby.started);
  els.btnStart.classList.toggle("hidden", !host || lobby.started);
}

export function sync(state, session) {
  if (!state) return;
  viewSession = session;
  const key = `${state.phase}:${state.round}:${session.playerId}:${state.fleetReady}:${state.ordersReady}:${state.attacksReady}:${state.status}`;
  if (key !== formKey) {
    formKey = key;
    draft = seedDraft(state, session);
    renderForm(state, session);
    publishPreview(state, session);
  }
  renderChrome(state, session);
  if (state.status === "done" && !shownWin) {
    shownWin = true;
    showWin(state, session);
  }
  if (state.status !== "done") shownWin = false;
}

function seedDraft(state, session) {
  if (session.isSpectator) return null;
  if (state.phase === "fleet" && !state.fleetReady) {
    return { fleet: (state.yourFleet || defaultFleet()).map((s) => ({ hull: s.hull, modules: [...s.modules] })) };
  }
  if (state.phase === "orders" && !state.ordersReady) {
    const suggested = suggestOrders(state, session.playerId);
    return { tab: suggested[0]?.shipId || "", orders: suggested };
  }
  if (state.phase === "attack" && !state.attacksReady) {
    return { attacks: suggestAttacks(state, session.playerId) };
  }
  return null;
}

function defaultFleet() {
  return [
    { hull: "rifter", modules: ["blasters", "nano"] },
    { hull: "rupture", modules: ["autocannons", "web", "dampener"] },
    { hull: "tempest", modules: ["artillery", "extender"] },
  ];
}

function renderForm(state, session) {
  if (session.isSpectator) {
    els.dock.innerHTML = `<p class="dock-lead">Watching the skirmish.</p>`;
    return;
  }
  if (state.status === "done") {
    els.dock.innerHTML = `<p class="dock-lead">${esc(winText(state))}</p>`;
    return;
  }
  if (state.phase === "fleet") {
    els.dock.innerHTML = state.fleetReady ? `<p class="dock-lead">Fleet locked. Waiting for the other pilots.</p>` : fleetForm(draft.fleet);
  } else if (state.phase === "orders") {
    els.dock.innerHTML = state.ordersReady ? `<p class="dock-lead">Orders locked. Waiting for the reveal.</p>` : orderForm(state, session);
  } else if (state.phase === "attack") {
    els.dock.innerHTML = state.attacksReady || !Object.keys(state.targets || {}).length
      ? `<p class="dock-lead">Volley locked.</p>`
      : attackForm(state);
  } else {
    els.dock.innerHTML = "";
  }
  wireForm(state, session);
}

function fleetForm(fleet) {
  const cards = fleet.map((fit, index) => {
    const hull = SHIPS[fit.hull];
    const used = rackUsed(fit);
    return `<section class="fit">
      <header><span>Ship ${index + 1}</span><strong>${used}/${hull.racks} racks</strong></header>
      <select data-hull="${index}">
        ${Object.values(SHIPS).map((s) => `<option value="${s.id}" ${s.id === fit.hull ? "selected" : ""}>${s.name} · ${s.size} · spd ${s.speed} agi ${s.agility} · ${s.racks} racks</option>`).join("")}
      </select>
      <div class="chips">${moduleChips(fit, index)}</div>
    </section>`;
  }).join("");
  const error = validateFleet(fleet);
  return `${cards}<p class="form-error">${error ? esc(error) : "Three ships. Lock when the racks look right."}</p>
    <button class="btn primary" data-act="fleet" type="button" ${error ? "disabled" : ""}>Lock fleet</button>`;
}

function moduleChips(fit, index) {
  const size = SHIPS[fit.hull].size;
  return Object.entries(CATALOG).map(([id, spec]) => {
    const cost = spec.cost[size];
    const on = fit.modules.includes(id);
    const na = cost == null;
    return `<button type="button" class="chip-btn ${on ? "on" : ""} ${na ? "na" : ""}" data-mod="${id}" data-slot="${index}" ${na ? "disabled" : ""}>
      <b>${esc(spec.name)}</b>
      <small>${spec.slot} · ${costLabel(spec.cost)}</small>
    </button>`;
  }).join("");
}

function orderForm(state, session) {
  const mine = myShips(state, session.playerId);
  const tab = draft.tab || mine[0]?.id;
  const ship = mine.find((s) => s.id === tab) || mine[0];
  const order = draft.orders.find((o) => o.shipId === ship?.id);
  if (!ship || !order) return `<p class="dock-lead">No ships left to plot.</p>`;
  const stats = statLine(ship, state.ships);
  const limit = travelLimit(stats.speed, {
    overdrive: order.overdrive,
    webbed: ship.webbed,
    energy: order.card === "hold" ? stats.energyMax : ship.energy,
    odCooldown: order.card === "hold" ? false : ship.odCooldown,
  });
  const used = cardUse(draft.orders, ship.id);
  return `<div class="tabs">${mine.map((s) => `<button type="button" data-tab="${s.id}" class="${s.id === ship.id ? "on" : ""}">${esc(s.name)}</button>`).join("")}</div>
    <p class="stat-line">${esc(ship.name)} · spd ${stats.speed} · agi ${stats.agility} · nrg ${ship.energy}/${stats.energyMax}${ship.webbed ? " · webbed" : ""}${ship.odCooldown ? " · OD cooling" : ""}</p>
    <div class="turn-row">
      <button type="button" data-turn="-1" aria-label="Fewer turns">−</button>
      <span class="tokens">${tokenStack(order.turn)}</span>
      <button type="button" data-turn="1" aria-label="More turns">+</button>
      <button type="button" data-dir="left" class="${order.turnDir === "left" ? "on" : ""}">Left</button>
      <button type="button" data-dir="right" class="${order.turnDir === "right" ? "on" : ""}">Right</button>
    </div>
    <p class="hint">Up to ${stats.agility} faces. ${order.turn || 0} stacked.</p>
    <div class="cards">${[...MANEUVERS, "hold"].map((id) => {
      const info = MANEUVER_INFO[id];
      const left = id === "hold" ? "" : ` · ${2 - (used[id] || 0)}`;
      const blocked = id !== "hold" && (used[id] || 0) >= 2 && order.card !== id;
    return `<button type="button" data-card="${id}" class="${order.card === id ? "on" : ""}" ${blocked ? "disabled" : ""}>${info.name}${left}</button>`;
    }).join("")}</div>
    ${order.card === "hold" ? `<label class="field">Face-down card<select data-spend>${MANEUVERS.map((id) => `<option value="${id}" ${order.holdSpend === id ? "selected" : ""}>${MANEUVER_INFO[id].name}</option>`).join("")}</select></label>` : ""}
    <div class="colors">${COLORS.map((c) => `<button type="button" data-color="${c.id}" class="color ${order.color === c.id ? "on" : ""}" style="--swatch:${c.hex}" ${c.dist > limit && order.card !== "hold" ? "disabled" : ""}>${c.name} ${c.dist}</button>`).join("")}</div>
    <div class="cards">${[["", "No Overdrive"], ["movement", "OD Move"], ["weapons", "OD Guns"], ["shield", "OD Shield"]].map(([id, label]) => `<button type="button" data-od="${id}" class="${(order.overdrive || "") === id ? "on" : ""}">${label}</button>`).join("")}</div>
    <label class="field">Focus<select data-focus>${foeOptions(state, session.playerId, order.focusId)}</select></label>
    <label class="field">Active<select data-active>${activeOptions(ship, order)}</select></label>
    ${order.active?.id === "neut" || order.active?.id === "web" ? `<label class="field">Module target<select data-target>${foeOptions(state, session.playerId, order.active.targetId)}</select></label>` : ""}
    <button class="btn primary" data-act="orders" type="button">Lock orders</button>
    <button class="btn ghost" data-act="suggest" type="button">Suggest</button>`;
}

function attackForm(state) {
  const rows = Object.entries(state.targets || {}).map(([shipId, targets]) => {
    const ship = state.ships.find((s) => s.id === shipId);
    const attack = draft.attacks.find((a) => a.shipId === shipId) || { shipId, weaponIndex: targets[0]?.weapons[0], targetId: targets[0]?.id };
    const weapons = [];
    ship.modules.forEach((id, index) => {
      if (CATALOG[id]?.slot === "weapon") weapons.push({ index, name: CATALOG[id].name });
    });
    return `<section class="fit">
      <header><span>${esc(ship.name)}</span><span>dmg ${ship.damage}</span></header>
      <label class="field">Weapon<select data-weapon="${shipId}">${weapons.map((w) => `<option value="${w.index}" ${Number(attack.weaponIndex) === w.index ? "selected" : ""}>${w.name}</option>`).join("")}</select></label>
      <label class="field">Target<select data-atk="${shipId}">${targets.map((t) => {
        const foe = state.ships.find((s) => s.id === t.id);
        return `<option value="${t.id}" ${attack.targetId === t.id ? "selected" : ""}>${esc(foe?.name || "Ship")} · ${t.dist} · ${foe?.transversal || "low"}</option>`;
      }).join("")}</select></label>
      ${ship.modules.includes("rapid") ? `<label class="field">If red, also fire<select data-follow="${shipId}"><option value="">No follow-up</option>${weapons.filter((w) => w.index !== Number(attack.weaponIndex)).map((w) => `<option value="${w.index}" ${Number(attack.followIndex) === w.index ? "selected" : ""}>${w.name}</option>`).join("")}</select></label>` : ""}
    </section>`;
  }).join("");
  return `${rows}<button class="btn primary" data-act="attack" type="button">Fire</button>`;
}

function wireForm(state, session) {
  els.dock.onchange = (e) => {
    const t = e.target;
    if (t.dataset.hull != null) {
      const fit = draft.fleet[Number(t.dataset.hull)];
      fit.hull = t.value;
      fit.modules = fit.modules.filter((id) => CATALOG[id]?.cost[SHIPS[fit.hull].size] != null);
      while (validateFleet(draft.fleet)) fit.modules.pop();
      renderForm(state, session);
    }
    if (t.dataset.spend != null) currentOrder().holdSpend = t.value;
    if (t.dataset.focus != null) {
      currentOrder().focusId = t.value || null;
      publishPreview(state, session);
    }
    if (t.dataset.active != null) {
      const order = currentOrder();
      order.active = t.value ? { id: t.value, targetId: order.active?.targetId || firstFoe(state, session.playerId) } : null;
      renderForm(state, session);
    }
    if (t.dataset.target != null && currentOrder().active) currentOrder().active.targetId = t.value;
    if (t.dataset.weapon != null) {
      const attack = attackOf(t.dataset.weapon);
      attack.weaponIndex = Number(t.value);
    }
    if (t.dataset.atk != null) attackOf(t.dataset.atk).targetId = t.value;
    if (t.dataset.follow != null) {
      const attack = attackOf(t.dataset.follow);
      attack.followIndex = t.value === "" ? null : Number(t.value);
      attack.followTargetId = attack.targetId;
    }
  };
  els.dock.onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.mod) return toggleMod(state, session, btn);
    if (btn.dataset.tab) {
      draft.tab = btn.dataset.tab;
      renderForm(state, session);
      publishPreview(state, session);
      return;
    }
    if (btn.dataset.turn) return stepTurn(state, session, Number(btn.dataset.turn));
    if (btn.dataset.dir) {
      currentOrder().turnDir = btn.dataset.dir;
      if (!currentOrder().turn) currentOrder().turn = 1;
      renderForm(state, session);
      publishPreview(state, session);
      return;
    }
    if (btn.dataset.card) {
      const order = currentOrder();
      order.card = btn.dataset.card;
      if (order.card === "hold" && !order.holdSpend) order.holdSpend = "approach";
      renderForm(state, session);
      publishPreview(state, session);
      return;
    }
    if (btn.dataset.color != null) {
      currentOrder().color = btn.dataset.color;
      renderForm(state, session);
      publishPreview(state, session);
      return;
    }
    if (btn.dataset.od != null) {
      currentOrder().overdrive = btn.dataset.od || null;
      renderForm(state, session);
      publishPreview(state, session);
      return;
    }
    if (btn.dataset.act === "fleet") hooks.fleet?.(draft.fleet);
    if (btn.dataset.act === "orders") {
      const mine = myShips(state, session.playerId);
      const error = validateOrders(mine, draft.orders, state.ships);
      if (error) return toast(error);
      hooks.orders?.(draft.orders);
    }
    if (btn.dataset.act === "suggest") {
      draft.orders = suggestOrders(state, session.playerId);
      renderForm(state, session);
      publishPreview(state, session);
    }
    if (btn.dataset.act === "attack") hooks.attack?.(draft.attacks);
  };
}

function toggleMod(state, session, btn) {
  const fit = draft.fleet[Number(btn.dataset.slot)];
  const id = btn.dataset.mod;
  if (fit.modules.includes(id)) fit.modules = fit.modules.filter((m) => m !== id);
  else {
    const next = [...fit.modules, id];
    const trial = draft.fleet.map((s, i) => i === Number(btn.dataset.slot) ? { ...s, modules: next } : s);
    if (validateFleet(trial)) return toast(validateFleet(trial));
    fit.modules = next;
  }
  renderForm(state, session);
}

function stepTurn(state, session, delta) {
  const ship = state.ships.find((s) => s.id === draft.tab) || myShips(state, session.playerId)[0];
  const stats = statLine(ship, state.ships);
  const order = currentOrder();
  order.turn = Math.max(0, Math.min(stats.agility, (order.turn || 0) + delta));
  if (order.turn && order.turnDir === "none") order.turnDir = "right";
  if (!order.turn) order.turnDir = "none";
  renderForm(state, session);
  publishPreview(state, session);
}

function currentOrder() {
  return draft.orders.find((o) => o.shipId === draft.tab) || draft.orders[0];
}

function attackOf(shipId) {
  let attack = draft.attacks.find((a) => a.shipId === shipId);
  if (!attack) {
    attack = { shipId, weaponIndex: 0, targetId: "" };
    draft.attacks.push(attack);
  }
  return attack;
}

function publishPreview(state, session) {
  if (state.phase !== "orders" || !draft?.orders) {
    hooks.preview?.([]);
    return;
  }
  const paths = [];
  for (const order of draft.orders) {
    const ship = state.ships.find((s) => s.id === order.shipId);
    if (!ship) continue;
    const color = colorById(order.color);
    const planned = previewPath(state, ship, order);
    paths.push({ path: planned.path, color: color?.hex || "#7ec8ff" });
  }
  hooks.preview?.(paths);
  hooks.focus?.(draft.tab);
}

function renderChrome(state, session) {
  const names = {
    fleet: "Fit fleets",
    orders: `Round ${state.round} · secret orders`,
    attack: `Round ${state.round} · attack`,
    done: "Skirmish over",
  };
  els.phaseText.textContent = names[state.phase] || state.phase;
  els.roster.innerHTML = state.players
    .filter((p) => !p.isSpectator)
    .map((p) => {
      const ships = state.ships.filter((s) => s.playerId === p.id);
      const ready = state.phase === "fleet" ? p.fleetReady : state.phase === "orders" ? p.ordersReady : p.attacksReady;
      return `<article class="pilot" style="--pilot:${p.color.hex}">
        <header><b>${esc(p.name)}</b>${ready ? "<span>locked</span>" : ""}</header>
        ${ships.map((s) => `<p><span>${esc(s.name)}</span> ${pipRow(s.shield, s.shieldMax, "shield")} ${pipRow(s.hullHp, s.hullMax, "hull")} <em>${s.energy} nrg</em></p>`).join("") || "<p>Fitting…</p>"}
      </article>`;
    }).join("");
  els.log.innerHTML = (state.log || []).slice(-8).map((line) => `<p>${esc(line)}</p>`).join("");
  const mine = session.isSpectator ? null : state.players.find((p) => p.id === session.playerId);
  if (mine && state.phase === "orders" && !state.ordersReady) els.dockToggle.textContent = "Orders";
  else if (state.phase === "attack") els.dockToggle.textContent = "Fire";
  else if (state.phase === "fleet") els.dockToggle.textContent = "Fleet";
  else els.dockToggle.textContent = "Log";
}

export function focusFromPointer(state, session, shipId) {
  if (!draft?.orders || state.phase !== "orders" || state.ordersReady) return;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return;
  if (ship.playerId === session.playerId) {
    draft.tab = ship.id;
    renderForm(state, session);
    publishPreview(state, session);
    return;
  }
  const order = currentOrder();
  if (!order) return;
  order.focusId = ship.id;
  if (order.active && (order.active.id === "web" || order.active.id === "neut")) order.active.targetId = ship.id;
  renderForm(state, session);
  publishPreview(state, session);
}

export function targetFromPointer(state, shipId) {
  if (!draft?.attacks || state.phase !== "attack") return;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return;
  const attackers = Object.keys(state.targets || {});
  if (attackers.includes(shipId)) return;
  const owner = draft.attacks.find((a) => state.targets[a.shipId]?.some((t) => t.id === shipId));
  const attack = owner || draft.attacks[0];
  if (!attack) return;
  if (!state.targets[attack.shipId]?.some((t) => t.id === shipId)) return toast("Out of range.");
  attack.targetId = shipId;
  renderForm(state, viewSession);
}

function showWin(state, session) {
  const host = session.playerId === state.hostId;
  els.modal.classList.remove("hidden");
  els.modal.innerHTML = `<div class="panel modal-panel">
    <p class="eyebrow">skirmish over</p>
    <h2>${esc(winText(state))}</h2>
    <div class="row-btns">
      ${host ? `<button id="btn-again" class="btn primary" type="button">Play again</button>` : ""}
      <button id="close-modal" class="btn ghost" type="button">Close</button>
    </div>
  </div>`;
  $("close-modal").onclick = () => els.modal.classList.add("hidden");
  $("btn-again")?.addEventListener("click", () => hooks.again?.());
}

export function showHow() {
  els.modal.classList.remove("hidden");
  els.modal.innerHTML = `<div class="panel modal-panel rules">
    <p class="eyebrow">how to play</p>
    <h2>SOURCE Skirmish</h2>
    <p>Each pilot brings 3 ships: any mix of Rifter, Rupture, and Tempest. Modules spend racks. A dash means that hull cannot fit it.</p>
    <p>Every round is secret. For each ship choose a facing change (stacked turn tokens, up to Agility), a maneuver, and a color. You have two of each maneuver. Hold spends one card face-down: energy refills, +1 shield, and spent modules and Overdrive reset.</p>
    <p>Light Blue moves 1, Light Green 2, Yellow 3. Red moves 4 and requires Overdrive Movement. Speed is the furthest color you can play without Overdrive. Overdrive costs 1 energy, once per ship until you Hold. Movement adds a color, Weapons adds 2 damage, Shield restores 1.</p>
    <p>Approach and Keep at Range are low transversal. Orbit and Strafe are high. Inside optimal with low transversal is a red hit (full damage). Other shots in range are yellow (damage − 1) or a miss. Outside falloff misses. Guns have no facing arc.</p>
    <p>Ships that end on the same hex, or trade places, collide. Both take 1 hull. The smaller ship takes 1 more per size step. Shields do not stop collisions. Knockback equals the hull lost, then each ship may twist one face.</p>
    <p>A ship at 0 hull is destroyed. If the collision killed it, it does not shoot. Otherwise it still fires. Last fleet flying wins.</p>
    <button id="close-modal" class="btn primary" type="button">Close</button>
  </div>`;
  $("close-modal").onclick = () => els.modal.classList.add("hidden");
}

function winText(state) {
  if (state.draw) return "Both fleets are gone.";
  const winner = state.players.find((p) => p.id === state.winnerId);
  return winner ? `${winner.name} holds the field.` : "Skirmish over.";
}

function myShips(state, playerId) {
  return state.ships.filter((s) => s.playerId === playerId && s.hullHp > 0);
}

function rackUsed(fit) {
  const size = SHIPS[fit.hull].size;
  return fit.modules.reduce((n, id) => n + (CATALOG[id]?.cost[size] || 0), 0);
}

function cardUse(orders, exceptId) {
  const used = {};
  for (const order of orders) {
    if (order.shipId === exceptId) continue;
    const spend = order.card === "hold" ? order.holdSpend : order.card;
    if (spend) used[spend] = (used[spend] || 0) + 1;
  }
  return used;
}

function tokenStack(n) {
  const count = Math.max(0, n || 0);
  if (!count) return "<i>0</i>";
  return Array.from({ length: count }, () => `<i class="token"></i>`).join("");
}

function foeOptions(state, playerId, selected) {
  const foes = state.ships.filter((s) => s.playerId !== playerId && s.hullHp > 0);
  if (!foes.length) return `<option value="">No enemies</option>`;
  return foes.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

function firstFoe(state, playerId) {
  return state.ships.find((s) => s.playerId !== playerId && s.hullHp > 0)?.id || null;
}

function activeOptions(ship, order) {
  const actives = ship.modules.filter((id) => CATALOG[id]?.slot === "active");
  const fresh = actives.filter((id) => order.card === "hold" || !ship.spent?.[id]);
  const current = order.active?.id || "";
  return `<option value="">No active</option>${fresh.map((id) => `<option value="${id}" ${id === current ? "selected" : ""}>${CATALOG[id].name}</option>`).join("")}`;
}

function pipRow(value, max, kind) {
  return `<span class="pips ${kind}">${Array.from({ length: max || 0 }, (_, i) => `<i class="${i < value ? "on" : ""}"></i>`).join("")}</span>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
