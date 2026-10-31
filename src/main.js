import { socket, emit } from "./net.js";
import { GameScene } from "./scene.js";
import { sfx, setMuted, setVolume, getVolume, unlockAudio } from "./audio.js";
import { els, bind, randomName, showScreen, toast, renderLobbyList, sync, showHow, focusFromPointer, targetFromPointer } from "./ui.js";

const canvas = document.getElementById("view");
const scene = new GameScene(canvas);

const session = {
  playerId: sessionStorage.getItem("skirmish.id") || "",
  code: sessionStorage.getItem("skirmish.code") || "",
  name: sessionStorage.getItem("skirmish.name") || "",
  isHost: false,
  isSpectator: false,
};

els.name.value = session.name || randomName();
let lastState = null;
let lastLobby = null;

bind({
  fleet: (ships) => emit("game:fleet", { ships }).then(done),
  orders: (orders) => emit("game:orders", { orders }).then(done),
  attack: (attacks) => emit("game:attack", { attacks }).then(done),
  again: () => emit("room:again").then(done),
  preview: (paths) => scene.setPreview(paths),
});

scene.onShip = (shipId) => {
  if (!lastState) return;
  if (lastState.phase === "orders") focusFromPointer(lastState, session, shipId);
  if (lastState.phase === "attack") targetFromPointer(lastState, shipId);
};
scene.onHex = (q, r) => {
  const ship = lastState?.ships?.find((s) => s.q === q && s.r === r);
  if (ship) scene.onShip(ship.id);
};

els.btnCreate.onclick = () => join(true);
els.btnPractice.onclick = () => join(true, { bots: 1, start: true });
els.btnJoin.onclick = () => join(false);
els.btnHow.onclick = showHow;
els.btnHelp.onclick = showHow;
const leave = () => {
  sessionStorage.clear();
  location.reload();
};
els.btnLeave.onclick = leave;
document.getElementById("btn-quit").onclick = leave;
els.btnCopy.onclick = async () => {
  const code = lastLobby?.code || session.code;
  try {
    await navigator.clipboard.writeText(code);
    toast("Copied " + code);
  } catch {
    toast(code);
  }
};
els.btnStart.onclick = () => emit("room:start").then(done);
els.btnBotsLess.onclick = () => setBots(Math.max(0, botCount(lastLobby) - 1));
els.btnBotsMore.onclick = () => setBots(Math.min(3, botCount(lastLobby) + 1));
els.dockToggle.onclick = () => els.dock.classList.toggle("collapsed");

function syncSound() {
  const level = Math.round(getVolume() * 100);
  if (els.volume) els.volume.value = String(level);
  const quiet = level === 0;
  els.btnMute.textContent = quiet ? "🔇" : "🔊";
}
syncSound();
els.btnMute.onclick = () => {
  setMuted(getVolume() > 0);
  syncSound();
};
els.volume?.addEventListener("input", () => {
  setVolume(Number(els.volume.value) / 100);
  syncSound();
});

document.body.addEventListener("pointerdown", () => unlockAudio(), { once: true });

socket.on("connect", () => {
  if (session.playerId && session.code) {
    emit("room:rejoin", { code: session.code, playerId: session.playerId }).then((res) => {
      if (res.error) return;
      save(res);
    });
  }
});

socket.on("lobby", (lobby) => {
  lastLobby = lobby;
  if (!session.playerId) return;
  showScreen("waiting");
  renderLobbyList(lobby, session.playerId);
});

socket.on("state", ({ lobby, state, events }) => {
  lastLobby = lobby;
  lastState = state;
  showScreen("play");
  renderLobbyList(lobby, session.playerId);
  scene.apply(state, events || []);
  sync(state, session);
  if (events?.some((e) => e.type === "attack" && e.quality === "red")) sfx("bop");
  if (state.status === "done") sfx("win");
});

socket.on("disconnect", () => toast("Connection lost. Reconnecting…"));

async function join(creating, extra = {}) {
  unlockAudio();
  sfx("click");
  const name = els.name.value.trim() || randomName();
  const payload = creating
    ? { name, bots: extra.bots || 0 }
    : { name, code: els.code.value.trim().toUpperCase(), spectator: els.spectator.checked };
  const res = await emit(creating ? "room:create" : "room:join", payload);
  if (res.error) return toast(res.error);
  save(res);
  if (extra.start) {
    const started = await emit("room:start");
    if (started.error) toast(started.error);
  }
}

function setBots(count) {
  emit("room:bots", { count }).then(done);
}

function done(res) {
  if (res?.error) toast(res.error);
  else sfx("click");
}

function save(res) {
  session.playerId = res.playerId;
  session.code = res.code;
  session.name = res.name;
  session.isHost = !!res.isHost;
  session.isSpectator = !!res.isSpectator;
  sessionStorage.setItem("skirmish.id", session.playerId);
  sessionStorage.setItem("skirmish.code", session.code);
  sessionStorage.setItem("skirmish.name", session.name || "");
}

function botCount(lobby) {
  return lobby?.players?.filter((p) => p.isBot).length || 0;
}
