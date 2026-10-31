/** Pointy-top axial hex math. World XZ, Y-up. */

export const HEX_SIZE = 1.08;

export const DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function key(q, r) {
  return `${q},${r}`;
}

export function parseKey(k) {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

export function add(a, d) {
  return { q: a.q + d.q, r: a.r + d.r };
}

export function neighbors(h) {
  return DIRS.map((d) => add(h, d));
}

export function distance(a, b) {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.r - b.r) +
      Math.abs(a.q + a.r - b.q - b.r)) /
    2
  );
}

export function hexToWorld(q, r, size = HEX_SIZE) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const z = size * (1.5 * r);
  return { x, z };
}

export function hexRound(q, r) {
  let s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
  else if (rDiff > sDiff) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function hexLine(a, b) {
  const n = distance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(hexRound(lerp(a.q, b.q, t), lerp(a.r, b.r, t)));
  }
  return out;
}

export function ring(radius) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) hexes.push({ q, r });
  }
  return hexes;
}

export function sameHex(a, b) {
  return a.q === b.q && a.r === b.r;
}

/**
 * A straight step leaves through one flat side and keeps going out the
 * opposite side of each hex. A path that turns, such as one step east and
 * then a step to the side, is not on a face line.
 * Returns { q, r, dist } for the face direction, or null.
 */
export function faceStep(from, to) {
  const dq = Number(to.q) - Number(from.q);
  const dr = Number(to.r) - Number(from.r);
  for (const d of DIRS) {
    const dist = d.q !== 0 ? dq / d.q : dr / d.r;
    if (dist < 1 || dist !== Math.trunc(dist)) continue;
    if (d.q * dist === dq && d.r * dist === dr) return { q: d.q, r: d.r, dist };
  }
  return null;
}

export function onFaceLine(from, to, maxDist = Infinity) {
  const step = faceStep(from, to);
  return !!step && step.dist <= maxDist;
}

/** True when every hex has the same axial cell, terrain, and elevation. */
export function sameHexLayout(current, next) {
  const a = [...current];
  const b = [...next];
  if (a.length !== b.length) return false;
  const by = new Map();
  for (const h of a) by.set(key(h.q, h.r), h);
  for (const h of b) {
    const prev = by.get(key(h.q, h.r));
    if (!prev) return false;
    if ((prev.terrain || "open") !== (h.terrain || "open")) return false;
    if ((prev.elevation ?? 0) !== (h.elevation ?? 0)) return false;
  }
  return true;
}
