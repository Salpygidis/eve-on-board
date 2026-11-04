import { MAX_PLAYERS, NAMES } from "../shared/constants.js";
import {
  AMMO,
  AMMO_SPOTS,
  CATALOG,
  COLORS,
  MANEUVERS,
  MANEUVER_INFO,
  SHIPS,
  colorById,
} from "../shared/catalog.js";
import { cardReach, isCooling, statLine, travelLimit, validateFleet, validateOrders } from "../shared/rules.js";
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
  seatRow: $("seat-row"),
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
  const offers = lobby.started ? [] : seatOffers(lobby.players, youId, false);
  els.seatRow.classList.toggle("hidden", !offers.length);
  els.seatRow.innerHTML = offers.map((offer) => seatButton(offer)).join("");
  wireSeats(els.seatRow);
}

export function sync(state, session) {
  if (!state) return;
  viewSession = session;
  const seats = state.players.map((p) => `${p.id}:${p.isSpectator}:${p.isBot}:${p.name}`).join("|");
  const key = `${state.phase}:${state.round}:${session.playerId}:${session.isSpectator}:${state.hostId}:${state.fleetReady}:${state.ordersReady}:${state.attacksReady}:${state.status}:${state.activation?.shipId || ""}:${seats}`;
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
    const saved = state.yourFleet;
    return {
      step: saved ? "racks" : "hull",
      hullIndex: 0,
      tab: "0",
      fleet: (saved || [0, 1, 2]).map((s) => ({
        hull: s.hull || null,
        modules: [...(s.modules || [])],
        ammo: [...(s.ammo || [])],
      })),
    };
  }
  if (state.phase === "orders" && !state.ordersReady) {
    const suggested = suggestOrders(state, session.playerId).map((order) => ({
      ...order,
      turn: 0,
      turnDir: "none",
      overdrive: null,
      color: "lb",
    }));
    return { tab: suggested[0]?.shipId || "", orders: suggested };
  }
  if (state.phase === "attack" && !state.attacksReady) {
    return { attack: suggestAttacks(state, session.playerId) };
  }
  return null;
}

function renderForm(state, session) {
  const fitting = !session.isSpectator && state.status !== "done" && state.phase === "fleet" && !state.fleetReady;
  els.dock.classList.toggle("setup", fitting);
  if (fitting) els.dock.classList.remove("collapsed");
  if (session.isSpectator) {
    const lead = state.status === "done" ? winText(state) : "Watching the skirmish.";
    els.dock.innerHTML = `<p class="dock-lead">${esc(lead)}</p>${endActions(state, session)}`;
    wireSeats(els.dock);
    syncMarks(state, session);
    return;
  }
  if (state.status === "done") {
    els.dock.innerHTML = `<p class="dock-lead">${esc(winText(state))}</p>${endActions(state, session)}`;
    wireSeats(els.dock);
    syncMarks(state, session);
    return;
  }
  if (state.phase === "fleet") {
    els.dock.innerHTML = state.fleetReady ? `<p class="dock-lead">Fleet locked. Waiting for the other pilots.</p>` : fleetForm(draft.fleet);
  } else if (state.phase === "orders") {
    els.dock.innerHTML = state.ordersReady ? `<p class="dock-lead">Orders locked. Waiting for the reveal.</p>` : orderForm(state, session);
  } else if (state.phase === "attack") {
    els.dock.innerHTML = state.attacksReady || !Object.keys(state.targets || {}).length
      ? `<p class="dock-lead">Volley locked.</p>`
      : attackForm(state, session);
  } else {
    els.dock.innerHTML = "";
  }
  wireForm(state, session);
  syncTable(state, session);
  syncMarks(state, session);
}

function syncMarks(state, session) {
  if (state.phase === "orders" && !state.ordersReady && draft?.orders) {
    const mine = myShips(state, session.playerId);
    const tab = draft.tab || mine[0]?.id;
    const ship = mine.find((s) => s.id === tab) || mine[0];
    hooks.marks?.(ship ? { selected: ship.id } : null);
    return;
  }
  const act = state.phase === "attack" ? state.activation : null;
  if (!act) {
    hooks.marks?.(null);
    return;
  }
  const choosing = act.playerId === session.playerId && draft?.attack?.shipId === act.shipId;
  hooks.marks?.({
    shooter: act.shipId,
    target: choosing ? draft.attack.targetId || "" : "",
  });
}

function fleetForm(fleet) {
  return draft.step === "racks" ? rackStep(fleet) : hullStep(fleet);
}

function hullStep(fleet) {
  const index = Math.max(0, Math.min(2, draft.hullIndex || 0));
  const fit = fleet[index];
  const looking = SHIPS[draft.hullLook] ? draft.hullLook : (fit.hull || "rifter");
  const shown = SHIPS[looking];
  const picks = Object.values(SHIPS).map((ship) => `<button type="button" class="hull-pick ${ship.id === fit.hull ? "on" : ""} ${ship.id === looking ? "look" : ""}" data-hull-pick="${ship.id}">
      <img src="${ship.art}" alt="${esc(ship.name)}">
      <span>${esc(ship.name)}</span>
    </button>`).join("");
  const progress = fleet.map((entry, i) => `Ship ${i + 1} ${entry.hull ? esc(SHIPS[entry.hull].name) : "—"}`).join(" · ");
  const last = index === 2;
  return `<p class="eyebrow">Ship ${index + 1} of 3</p>
    <p class="hint">Point at a hull to read it, then choose it. Racks open after all three ships.</p>
    <div class="fit-stage">
      <div class="fit-picks">
        <section class="fit-line">
          <h3>Hulls</h3>
          <div class="hand hull-row">${picks}</div>
        </section>
      </div>
      <figure class="fit-preview">
        <img src="${shown.art}" alt="${esc(shown.name)}">
      </figure>
    </div>
    <p class="hint">${progress}</p>
    <div class="row-btns">
      ${index > 0 ? `<button type="button" class="btn ghost" data-setup="back">Back</button>` : ""}
      <button type="button" class="btn primary" data-setup="next" ${fit.hull ? "" : "disabled"}>${last ? "Fit racks" : `Next · Ship ${index + 2}`}</button>
    </div>`;
}

function rackStep(fleet) {
  const slot = fleet[Number(draft.tab)] ? Number(draft.tab) : 0;
  const fit = fleet[slot];
  const hull = SHIPS[fit.hull];
  const used = rackUsed(fit);
  const ships = fleet.map((entry, index) => {
    const chosen = SHIPS[entry.hull];
    return `<button type="button" class="hull-pick ${index === slot ? "on" : ""}" data-ship-slot="${index}">
      <img src="${chosen.art}" alt="${esc(chosen.name)}">
      <span>${esc(chosen.name)}</span>
    </button>`;
  }).join("");
  const shown = inspectedSpec();
  const shownWide = shown.slot === "weapon" || inspectedId() === "bomb";
  const error = validateFleet(fleet);
  return `<p class="hint">${esc(hull.name)} · ${used}/${hull.racks} racks</p>
    <div class="fit-stage rack-stage">
      <section class="fit-line ship-line">
        <h3>Ships</h3>
        <div class="hand hull-row">${ships}</div>
      </section>
      <div class="fit-picks">
        <section class="fit-line">
          <h3>Weapons</h3>
          <div class="hand">${catalogCards(fit, slot, "weapon")}</div>
          ${ammoRow(fit)}
        </section>
        <section class="fit-line">
          <h3>Modules</h3>
          <div class="hand">${catalogCards(fit, slot, "module")}</div>
        </section>
      </div>
      <figure class="fit-preview${shownWide ? " wide" : ""}">
        ${cardFace(inspectedId(), shown.art, shown.name, chosenAmmo(fit, inspectedId()))}
      </figure>
    </div>
    <p class="form-error">${error ? esc(error) : "Put an ammo token on each gun, then lock the fleet."}</p>
    <div class="row-btns">
      <button type="button" class="btn ghost" data-setup="hulls">Change hulls</button>
      <button class="btn primary" data-act="fleet" type="button" ${error ? "disabled" : ""}>Lock fleet</button>
    </div>`;
}

function catalogCards(fit, index, kind) {
  const size = SHIPS[fit.hull].size;
  return Object.entries(CATALOG)
    .filter(([, spec]) => (kind === "weapon" ? spec.slot === "weapon" : spec.slot !== "weapon"))
    .map(([id, spec]) => {
      const cost = spec.cost[size];
      const on = fit.modules.includes(id);
      const na = cost == null;
      const look = id === (draft.inspect || inspectedId());
      const landscape = spec.slot === "weapon" || id === "bomb";
      return `<button type="button" class="play-card${landscape ? " landscape" : ""} ${on ? "on" : ""} ${look ? "look" : ""} ${na ? "na" : ""}" data-mod="${id}" data-slot="${index}">
      <img src="${spec.art}" alt="${esc(spec.name)}">
      <span>${esc(spec.name)}</span>
      <b>${na ? "NA" : cost}</b>
    </button>`;
    })
    .join("");
}

function inspectedId() {
  if (CATALOG[draft.inspect]) return draft.inspect;
  return Object.keys(CATALOG).find((id) => CATALOG[id].slot === "weapon");
}

function inspectedSpec() {
  return CATALOG[inspectedId()];
}

function focusHullCard(id) {
  const ship = SHIPS[id];
  if (!ship || draft.hullLook === id) return;
  draft.hullLook = id;
  const img = els.dock.querySelector(".fit-preview img");
  if (img) {
    img.src = ship.art;
    img.alt = ship.name;
  }
  els.dock.querySelectorAll(".hull-pick.look").forEach((node) => node.classList.remove("look"));
  els.dock.querySelector(`[data-hull-pick="${id}"]`)?.classList.add("look");
}

function chosenAmmo(fit, id) {
  if (!fit || !CATALOG[id]) return "";
  const index = fit.modules.indexOf(id);
  if (index < 0) return "";
  return fit.ammo?.[index] || CATALOG[id].ammo?.[0] || "";
}

function ammoSpot(id, ammoId) {
  const spots = AMMO_SPOTS[id];
  const index = CATALOG[id]?.ammo?.indexOf(ammoId);
  if (!spots || index == null || index < 0) return null;
  return spots[index] || null;
}

function ammoMark(id, ammoId) {
  const spot = ammoSpot(id, ammoId);
  if (!spot) return "";
  return `<i class="ammo-mark" style="left:${spot[0]}%;top:${spot[1]}%" title="${esc(AMMO[ammoId]?.name || "")}"></i>`;
}

function cardFace(id, art, alt, ammoId) {
  return `<div class="card-face"><img src="${art}" alt="${esc(alt)}">${ammoMark(id, ammoId)}</div>`;
}

function setAmmoMark(figure, id) {
  const face = figure?.querySelector(".card-face");
  if (!face) return;
  face.querySelector(".ammo-mark")?.remove();
  const slot = Number(draft.tab) || 0;
  const spot = ammoSpot(id, chosenAmmo(draft.fleet?.[slot], id));
  if (!spot) return;
  const mark = document.createElement("i");
  mark.className = "ammo-mark";
  mark.style.left = `${spot[0]}%`;
  mark.style.top = `${spot[1]}%`;
  mark.title = AMMO[chosenAmmo(draft.fleet?.[slot], id)]?.name || "";
  face.appendChild(mark);
}

function focusFitCard(id) {
  const spec = CATALOG[id];
  if (!spec || draft.inspect === id) return false;
  draft.inspect = id;
  const figure = els.dock.querySelector(".fit-preview");
  const img = figure?.querySelector("img");
  if (img) {
    img.src = spec.art;
    img.alt = spec.name;
  }
  figure?.classList.toggle("wide", spec.slot === "weapon" || id === "bomb");
  setAmmoMark(figure, id);
  els.dock.querySelectorAll(".play-card.look").forEach((node) => node.classList.remove("look"));
  els.dock.querySelector(`[data-mod="${id}"]`)?.classList.add("look");
  return true;
}

function rangeText(spec, color) {
  const dists = [];
  (spec.bands || []).forEach((band, index) => {
    if (band && band[0] === color) dists.push(index);
  });
  if (!dists.length) return "";
  const parts = [];
  let start = dists[0];
  let prev = dists[0];
  for (let i = 1; i <= dists.length; i++) {
    if (dists[i] === prev + 1) {
      prev = dists[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = dists[i];
  }
  return parts.join(", ");
}

function gunNotes(ship) {
  const overcharge = ship.modules.includes("overcharge");
  const lines = [];
  ship.modules.forEach((id, index) => {
    const spec = CATALOG[id];
    if (spec?.slot !== "weapon") return;
    const ammo = AMMO[ship.ammo?.[index]] || AMMO[spec.ammo?.[0]];
    const red = rangeText(spec, "red");
    const yellow = overcharge ? rangeText(spec, "yellow") : "";
    lines.push(`<p><b>${esc(spec.name)}</b> ${esc(ammo?.name || "")} · red ${red || "—"}${yellow ? ` · OD red ${yellow}` : ""}</p>`);
  });
  if (!lines.length) return "";
  return `<div class="gun-notes"><h3>Guns</h3>${lines.join("")}</div>`;
}

function ammoRow(fit) {
  const rows = fit.modules.map((id, index) => {
    const spec = CATALOG[id];
    if (spec?.slot !== "weapon") return "";
    const picked = fit.ammo?.[index] || spec.ammo[0];
    return `<div class="ammo"><span>${esc(spec.name)}</span>${spec.ammo.map((ammo) => `<button type="button" data-ammo="${index}:${ammo}" class="${picked === ammo ? "on" : ""}">${esc(AMMO[ammo].name)}</button>`).join("")}</div>`;
  }).join("");
  return rows ? `<div class="ammo-row">${rows}</div>` : "";
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
    odCooldown: order.card === "hold" ? false : isCooling(ship, "movement"),
  });
  const used = cardUse(draft.orders, ship.id);
  const shown = order.card === "hold" ? order.holdSpend : order.card;
  const shownInfo = MANEUVER_INFO[shown] || MANEUVER_INFO.approach;
  return `<div class="tabs">${mine.map((s) => `<button type="button" data-tab="${s.id}" class="${s.id === ship.id ? "on" : ""}">${esc(s.name)}</button>`).join("")}</div>
    <p class="stat-line">${esc(ship.name)} · spd ${stats.speed} · agi ${stats.agility} · nrg ${ship.energy}/${stats.energyMax}${ship.webbed ? " · webbed" : ""} ${odPips(ship)}</p>
    <div class="turn-row">
      <button type="button" data-turn="-1" aria-label="Fewer turns">−</button>
      <span class="tokens">${tokenStack(order.turn)}</span>
      <button type="button" data-turn="1" aria-label="More turns">+</button>
      <button type="button" data-dir="left" class="${order.turnDir === "left" ? "on" : ""}">Left</button>
      <button type="button" data-dir="right" class="${order.turnDir === "right" ? "on" : ""}">Right</button>
    </div>
    <p class="hint">Up to ${stats.agility} faces. ${order.turn || 0} stacked. Deck has 2 of each card.</p>
    ${gunNotes(ship)}
    <div class="hand">${MANEUVERS.map((id) => {
      const info = MANEUVER_INFO[id];
      const using = order.card === id || (order.card === "hold" && order.holdSpend === id);
      const left = 2 - (used[id] || 0) - (using ? 1 : 0);
      const blocked = !using && (used[id] || 0) >= 2;
      return `<button type="button" data-card="${id}" class="play-card ${order.card === id ? "on" : ""} ${order.card === "hold" && order.holdSpend === id ? "down" : ""}" ${blocked ? "disabled" : ""}>
        <img src="${info.art}" alt="${esc(info.name)}">
        <span>${esc(info.name)}</span>
        <b>${copyPips(left)}</b>
      </button>`;
    }).join("")}</div>
    <button type="button" data-card="hold" class="btn ${order.card === "hold" ? "primary" : "ghost"}">Hold · face down</button>
    ${shownInfo.art ? `<figure class="card-sheet ${order.card === "hold" ? "down" : ""}"><img src="${shownInfo.art}" alt="${esc(shownInfo.name)}"><figcaption>${esc(shownInfo.blurb)}</figcaption></figure>` : ""}
    <div class="colors">${COLORS.map((c) => {
      const reach = cardReach(shown, c.id);
      return `<button type="button" data-color="${c.id}" class="color ${order.color === c.id ? "on" : ""}" style="--swatch:${c.hex}" ${c.dist > limit && order.card !== "hold" ? "disabled" : ""}>${c.name} ${reach}</button>`;
    }).join("")}</div>
    <div class="cards">${[["", "No Overdrive"], ["movement", "OD Move"], ["weapons", "OD Guns"], ["shield", "OD Shield"]].map(([id, label]) => `<button type="button" data-od="${id}" class="${(order.overdrive || "") === id ? "on" : ""}">${label}</button>`).join("")}</div>
    <label class="field">Active<select data-active>${activeOptions(ship, order)}</select></label>
    ${order.active?.id === "neut" || order.active?.id === "web" ? `<label class="field">Module target<select data-target>${foeOptions(state, session.playerId, order.active.targetId)}</select></label>` : ""}
    <button class="btn primary" data-act="orders" type="button">Lock orders</button>
    <button class="btn ghost" data-act="suggest" type="button">Suggest</button>`;
}

function attackForm(state, session) {
  const act = state.activation;
  if (!act) return `<p class="hint">Attack phase is settling.</p>`;
  if (act.playerId !== session.playerId) return `<p class="hint">${esc(act.name)} is choosing a shot.</p>`;
  const targets = state.targets?.[act.shipId] || [];
  const ship = state.ships.find((s) => s.id === act.shipId);
  if (!ship) return `<p class="hint">That ship is gone.</p>`;
  const attack = draft.attack?.shipId === ship.id ? draft.attack : { shipId: ship.id, weaponIndex: targets[0]?.weapons[0], targetId: targets[0]?.id };
  draft.attack = attack;
  const weapons = [];
  ship.modules.forEach((id, index) => {
    if (CATALOG[id]?.slot === "weapon") weapons.push({ index, name: CATALOG[id].name, art: CATALOG[id].art, ammo: ship.ammo?.[index] });
  });
  const chosen = weapons.find((w) => w.index === Number(attack.weaponIndex)) || weapons[0];
  return `<section class="fit">
    <header><span>${esc(ship.name)} fires</span><span>${esc(chosen?.ammo ? AMMO[chosen.ammo]?.name || "" : "")}</span></header>
    ${chosen ? `<div class="card-sheet">${cardFace(ship.modules[chosen.index], chosen.art, chosen.name, chosen.ammo)}</div>` : ""}
    <label class="field">Weapon<select data-weapon="${ship.id}">${weapons.map((w) => `<option value="${w.index}" ${Number(attack.weaponIndex) === w.index ? "selected" : ""}>${w.name}</option>`).join("")}</select></label>
    <label class="field">Target<select data-atk="${ship.id}">${targets.map((t) => {
      const foe = state.ships.find((s) => s.id === t.id);
      return `<option value="${t.id}" ${attack.targetId === t.id ? "selected" : ""}>${esc(foe?.name || "Ship")} · ${t.dist}</option>`;
    }).join("")}</select></label>
    ${ship.modules.includes("rapid") ? `<label class="field">If red, also fire<select data-follow="${ship.id}"><option value="">No follow-up</option>${weapons.filter((w) => w.index !== Number(attack.weaponIndex)).map((w) => `<option value="${w.index}" ${Number(attack.followIndex) === w.index ? "selected" : ""}>${w.name}</option>`).join("")}</select></label>` : ""}
  </section>
  <button class="btn primary" data-act="attack" type="button">Fire</button>
  <button class="btn ghost" data-act="pass" type="button">Pass</button>`;
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
    if (t.dataset.weapon != null && draft.attack) {
      draft.attack.weaponIndex = Number(t.value);
      renderForm(state, session);
    }
    if (t.dataset.atk != null && draft.attack) draft.attack.targetId = t.value;
    if (t.dataset.follow != null && draft.attack) {
      draft.attack.followIndex = t.value === "" ? null : Number(t.value);
      draft.attack.followTargetId = draft.attack.targetId;
    }
  };
  els.dock.onpointerover = (e) => {
    if (!draft) return;
    const card = e.target.closest("[data-mod]");
    if (card && draft.step === "racks" && focusFitCard(card.dataset.mod)) syncTable(state, session);
    const hull = e.target.closest("[data-hull-pick]");
    if (hull && draft.step !== "racks") focusHullCard(hull.dataset.hullPick);
  };
  els.dock.onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.mod) return toggleMod(state, session, btn);
    if (btn.dataset.ammo) {
      const [index, ammo] = btn.dataset.ammo.split(":");
      const fit = draft.fleet[Number(draft.tab) || 0];
      fit.ammo = fit.ammo || [];
      fit.ammo[Number(index)] = ammo;
      renderForm(state, session);
      return;
    }
    if (btn.dataset.hullPick) {
      const index = draft.step === "racks" ? Number(draft.tab) || 0 : (draft.hullIndex || 0);
      draft.hullLook = btn.dataset.hullPick;
      setHull(index, btn.dataset.hullPick);
      renderForm(state, session);
      return;
    }
    if (btn.dataset.setup === "back") {
      draft.hullIndex = Math.max(0, (draft.hullIndex || 0) - 1);
      draft.hullLook = draft.fleet[draft.hullIndex]?.hull || null;
      renderForm(state, session);
      return;
    }
    if (btn.dataset.setup === "next") {
      const index = draft.hullIndex || 0;
      if (!draft.fleet[index]?.hull) return;
      draft.hullLook = null;
      if (index < 2) draft.hullIndex = index + 1;
      else {
        draft.step = "racks";
        draft.tab = "0";
      }
      renderForm(state, session);
      return;
    }
    if (btn.dataset.setup === "hulls") {
      draft.step = "hull";
      draft.hullIndex = Number(draft.tab) || 0;
      renderForm(state, session);
      return;
    }
    if (btn.dataset.shipSlot != null) {
      draft.tab = btn.dataset.shipSlot;
      renderForm(state, session);
      return;
    }
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
      if (btn.dataset.card === "hold") {
        if (order.card === "hold") order.card = order.holdSpend || "approach";
        else {
          order.holdSpend = MANEUVERS.includes(order.card) ? order.card : (order.holdSpend || "approach");
          order.card = "hold";
          order.overdrive = null;
          order.active = null;
        }
      } else if (order.card === "hold") {
        order.holdSpend = btn.dataset.card;
      } else {
        order.card = btn.dataset.card;
      }
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
    if (btn.dataset.act === "attack") hooks.attack?.(draft.attack);
    if (btn.dataset.act === "pass") hooks.attack?.({ shipId: state.activation?.shipId, pass: true });
  };
}

function setHull(index, hullId) {
  const fit = draft.fleet[index];
  const size = SHIPS[hullId].size;
  const modules = [];
  const ammo = [];
  (fit.modules || []).forEach((id, i) => {
    if (CATALOG[id]?.cost[size] != null) {
      modules.push(id);
      ammo.push(fit.ammo?.[i] ?? null);
    }
  });
  fit.hull = hullId;
  fit.modules = modules;
  fit.ammo = ammo;
  while (rackUsed(fit) > SHIPS[hullId].racks) {
    fit.modules.pop();
    fit.ammo.pop();
  }
}

function toggleMod(state, session, btn) {
  const fit = draft.fleet[Number(btn.dataset.slot)];
  const id = btn.dataset.mod;
  draft.inspect = id;
  fit.ammo = fit.ammo || [];
  if (fit.modules.includes(id)) {
    const at = fit.modules.indexOf(id);
    fit.modules.splice(at, 1);
    fit.ammo.splice(at, 1);
  } else {
    const spec = CATALOG[id];
    const next = [...fit.modules, id];
    const trial = draft.fleet.map((s, i) => i === Number(btn.dataset.slot) ? { ...s, modules: next } : s);
    if (validateFleet(trial)) return toast(validateFleet(trial));
    fit.modules = next;
    fit.ammo.push(spec?.slot === "weapon" ? spec.ammo[0] : null);
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

function syncTable(state, session) {
  if (session.isSpectator || state.status === "done") {
    hooks.table?.([]);
    return;
  }
  if (state.phase === "orders" && draft?.orders) {
    hooks.table?.(draft.orders.map((order) => {
      const ship = state.ships.find((s) => s.id === order.shipId);
      const shown = order.card === "hold" ? "" : order.card;
      const info = MANEUVER_INFO[shown];
      return {
        shipId: order.shipId,
        name: ship?.name || "Ship",
        art: info?.art || "",
        facedown: order.card === "hold",
        color: colorById(order.color)?.hex || "",
        turn: order.turn || 0,
        turnDir: order.turnDir || "none",
        overdrive: order.overdrive || "",
        focus: order.shipId === draft.tab,
      };
    }), draft.tab);
    return;
  }
  if (state.phase === "orders") return;
  if (state.phase === "fleet" && !state.fleetReady && draft?.fleet) {
    const mine = myShips(state, session.playerId);
    const cards = [];
    const slot = Number(draft.tab) || 0;
    draft.fleet.forEach((fit, index) => {
      if (!fit.hull) return;
      const looking = SHIPS[draft.hullLook] ? draft.hullLook : fit.hull;
      cards.push({
        shipId: mine[index]?.id || `hull-${index}`,
        name: `Ship ${index + 1}`,
        art: SHIPS[fit.hull].art,
        row: draft.step === "racks" ? "ship" : "",
        focus: draft.step === "racks" ? index === slot : draft.step !== "racks" && index === (draft.hullIndex || 0) && looking === fit.hull,
      });
    });
    if (draft.step === "racks") {
      const fit = draft.fleet[slot];
      const ship = mine[slot];
      const seen = new Set();
      const pushGear = (id, focus) => {
        const spec = CATALOG[id];
        if (!spec || seen.has(id)) return;
        seen.add(id);
        const fitted = (fit?.modules || []).indexOf(id);
        const ammoId = fitted >= 0 ? (fit.ammo?.[fitted] || spec.ammo?.[0] || "") : "";
        cards.push({
          shipId: ship?.id || "rack",
          name: spec.name,
          art: spec.art,
          row: "gear",
          wide: spec.slot === "weapon" || id === "bomb",
          spot: ammoSpot(id, ammoId),
          focus,
        });
      };
      (fit?.modules || []).forEach((id) => pushGear(id, id === draft.inspect));
      if (draft.inspect) pushGear(draft.inspect, true);
    } else if (!cards.length) {
      const ship = SHIPS[draft.hullLook] || SHIPS.rifter;
      cards.push({ shipId: "hull", name: ship.name, art: ship.art, focus: true });
    }
    hooks.table?.(cards);
    return;
  }
  if (state.phase === "attack" && draft?.attack && !draft.attack.pass) {
    const ship = state.ships.find((s) => s.id === draft.attack.shipId);
    const weapon = ship && CATALOG[ship.modules?.[draft.attack.weaponIndex]];
    if (weapon?.art) {
      const weaponId = ship.modules[Number(draft.attack.weaponIndex)];
      hooks.table?.([{
        shipId: ship.id,
        name: weapon.name,
        art: weapon.art,
        wide: true,
        spot: ammoSpot(weaponId, ship.ammo?.[Number(draft.attack.weaponIndex)]),
        focus: true,
      }]);
      return;
    }
  }
  hooks.table?.([]);
}

function publishPreview(state, session) {
  syncTable(state, session);
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
        ${ships.map((s) => `<p><span>${esc(s.name)}</span> ${pipRow(s.shield, s.shieldMax, "shield")} ${pipRow(s.armor, s.armorMax, "armor")} ${pipRow(s.hullHp, s.hullMax, "hull")} <em>${s.energy} nrg</em></p>`).join("") || "<p>Fitting…</p>"}
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
  if (!draft?.attack || state.phase !== "attack") return;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.id === state.activation?.shipId) return;
  if (!state.targets[draft.attack.shipId]?.some((t) => t.id === shipId)) return toast("Out of range.");
  draft.attack.targetId = shipId;
  renderForm(state, viewSession);
}

function showWin(state, session) {
  els.modal.classList.remove("hidden");
  els.modal.innerHTML = `<div class="panel modal-panel">
    <p class="eyebrow">skirmish over</p>
    <h2>${esc(winText(state))}</h2>
    ${endActions(state, session)}
    <div class="row-btns">
      <button id="close-modal" class="btn ghost" type="button">Close</button>
    </div>
  </div>`;
  wireSeats(els.modal);
  $("close-modal").onclick = () => els.modal.classList.add("hidden");
}

function seatOffers(players, youId, playing) {
  const you = players.find((p) => p.id === youId);
  if (!you?.isSpectator) return [];
  const pilots = players.filter((p) => !p.isSpectator);
  const bots = pilots.filter((p) => p.isBot);
  if (bots.length) {
    return bots.map((p) => ({ id: p.id, label: bots.length > 1 ? `Swap in for ${p.name}` : "Swap in" }));
  }
  const empty = pilots.filter((p) => !p.connected);
  if (empty.length) return empty.map((p) => ({ id: p.id, label: `Take ${p.name}'s seat` }));
  if (!playing && pilots.length < MAX_PLAYERS) return [{ id: "open", label: "Take a seat" }];
  if (!playing) return pilots.map((p) => ({ id: p.id, label: `Swap with ${p.name}` }));
  return [];
}

function seatButton(offer) {
  return `<button data-seat="${esc(offer.id)}" class="btn" type="button">${esc(offer.label)}</button>`;
}

function endActions(state, session) {
  const offers = seatOffers(state.players, session.playerId, state.status === "playing");
  const replay = state.status === "done" && session.playerId === state.hostId;
  if (!replay && !offers.length) return "";
  return `<div class="row-btns end-actions">
    ${replay ? `<button data-act="again" class="btn primary" type="button">Replay</button>` : ""}
    ${offers.map((offer) => seatButton(offer)).join("")}
  </div>`;
}

function wireSeats(root) {
  root.querySelectorAll("[data-seat]").forEach((btn) => {
    btn.onclick = () => hooks.seat?.(btn.dataset.seat === "open" ? "" : btn.dataset.seat);
  });
  root.querySelectorAll("[data-act=again]").forEach((btn) => {
    btn.onclick = () => {
      els.modal.classList.add("hidden");
      hooks.again?.();
    };
  });
}

export function showHow() {
  els.modal.classList.remove("hidden");
  els.modal.innerHTML = `<div class="panel modal-panel rules">
    <p class="eyebrow">how to play</p>
    <h2>SOURCE Skirmish</h2>
    <p>Choose ship 1, ship 2, and ship 3. Any mix of Small, Medium, and Large. Then fit each ship: weapons on one line, modules on another, up to the rack limit. Put an ammo token on each gun for the whole match.</p>
    <p>Hidden phase: turn tokens up to Agility, one movement card face-down, and a color token on that card. Speed 1 reaches blue, 2 green, 3 yellow. Speed 4 or Overdrive Movement reaches red. One Overdrive per ship. Smart Bomb and Stealth are played here.</p>
    <p>Everyone moves at once. Ships that cross or finish on the same hex collide immediately. Then ships take turns firing one weapon. A red-zone hit can trigger Rapid Weapons. Armor reduces a hit by 1 when the first point lands on armor. An ammo bonus applies only when that first point hits its layer.</p>
    <p>Hold is a face-down card and a full skip. If the ship is still alive after the shooting, it refills energy, gains 1 shield, and resets modules and Overdrive. Auxiliary Armor Repairer also restores 1 armor.</p>
    <p>Last fleet flying wins.</p>
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

function odPips(ship) {
  const cool = ship.odCool || {};
  const labels = [["movement", "Speed"], ["shield", "Shields"], ["weapons", "Damage"]];
  return `<span class="od-pips">${labels.map(([id, label]) => `<i class="${cool[id] ? "hot" : ""}">${label}</i>`).join("")}</span>`;
}

function copyPips(left) {
  return `${"●".repeat(Math.max(0, left))}${"○".repeat(Math.max(0, 2 - left))}`;
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
  const fresh = order.card === "hold" ? [] : actives.filter((id) => !ship.spent?.[id]);
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
