let ctx;
let muted = false;
let volume = 1;
let lastAudible = 1;

const VOLUME_KEY = "skirmish.volume";
const BGM_URL = "/final-drop.mp3";
const BGM_VOLUME = 0.35;
const bgm = new Audio(BGM_URL);
bgm.loop = true;
bgm.preload = "auto";

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function readStoredVolume() {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw == null || raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    volume = clampVolume(n);
    if (volume > 0) lastAudible = volume;
    muted = volume === 0;
  } catch {
    /* private mode */
  }
}

function storeVolume() {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    /* private mode */
  }
}

function applyBgmVolume() {
  bgm.volume = BGM_VOLUME * volume;
}

readStoredVolume();
applyBgmVolume();

let wantBgm = false;
let primed = false;
let priming = false;

function syncBgm() {
  if (wantBgm && !muted) {
    if (bgm.paused) bgm.play().catch(() => {});
    return;
  }
  if (!bgm.paused) bgm.pause();
  if (!wantBgm) {
    try {
      bgm.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
  }
}

/** Loop the battle track once fleets are on the grid. Lobby and fitting stay quiet. */
export function setMatchMusic(on) {
  wantBgm = !!on;
  syncBgm();
}

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Master level from 0 to 1. Zero mutes music and effects. */
export function getVolume() {
  return volume;
}

export function setVolume(v) {
  const next = clampVolume(v);
  if (next > 0) lastAudible = next;
  volume = next;
  muted = next === 0;
  storeVolume();
  applyBgmVolume();
  syncBgm();
}

export function setMuted(v) {
  setVolume(v ? 0 : lastAudible || 1);
}

export function isMuted() {
  return muted;
}

function beep(freq, dur, type = "sine", gain = 0.07) {
  const level = gain * volume;
  if (muted || level <= 0.001) return;
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(level, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

export function sfx(kind) {
  if (kind === "hop") {
    beep(420, 0.09, "triangle", 0.05);
    setTimeout(() => beep(540, 0.08, "triangle", 0.04), 70);
  } else if (kind === "slurp") {
    beep(220, 0.16, "sawtooth", 0.04);
    setTimeout(() => beep(380, 0.12, "sine", 0.05), 80);
  } else if (kind === "bop") {
    beep(90, 0.14, "square", 0.06);
  } else if (kind === "win") {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.2, "sine", 0.06), i * 120));
  } else if (kind === "click") {
    beep(700, 0.05, "sine", 0.03);
  } else if (kind === "card") {
    beep(880, 0.12, "triangle", 0.05);
  } else if (kind === "freebounce") {
    boing();
  } else if (kind === "turn") {
    ding();
  }
}

function ding() {
  const peak = 0.09 * volume;
  if (muted || peak <= 0.001) return;
  const c = ac();
  const t = c.currentTime;
  const bell = c.createOscillator();
  const over = c.createOscillator();
  const g = c.createGain();
  const g2 = c.createGain();
  bell.type = "sine";
  over.type = "triangle";
  bell.frequency.setValueAtTime(1174, t);
  over.frequency.setValueAtTime(1760, t);
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  g2.gain.setValueAtTime(peak * 0.28, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  bell.connect(g);
  over.connect(g2);
  g.connect(c.destination);
  g2.connect(c.destination);
  bell.start(t);
  over.start(t);
  bell.stop(t + 0.72);
  over.stop(t + 0.42);
}

function boing() {
  const peak = 0.08 * volume;
  if (muted || peak <= 0.001) return;
  const c = ac();
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(196, t);
  o.frequency.exponentialRampToValueAtTime(740, t + 0.08);
  o.frequency.exponentialRampToValueAtTime(280, t + 0.2);
  o.frequency.exponentialRampToValueAtTime(988, t + 0.32);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.56);
  setTimeout(() => beep(1318, 0.14, "square", 0.035), 180);
}

export function unlockAudio() {
  try {
    ac();
  } catch {
    /* ignore */
  }
  if (primed) {
    syncBgm();
    return;
  }
  if (priming) return;
  priming = true;
  bgm.volume = 0;
  const pending = bgm.play();
  const finish = () => {
    bgm.pause();
    try {
      bgm.currentTime = 0;
    } catch {
      /* not seekable yet */
    }
    applyBgmVolume();
    priming = false;
    primed = true;
    syncBgm();
  };
  if (pending && typeof pending.then === "function") {
    pending.then(finish).catch(() => {
      applyBgmVolume();
      priming = false;
    });
  } else {
    finish();
  }
}
