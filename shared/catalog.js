/** Ships, fittings, movement colors, and maneuver cards. */

export const SIZE_RANK = { small: 1, medium: 2, large: 3 };

export const SHIPS = {
  rifter: {
    id: "rifter",
    name: "Rifter",
    size: "small",
    speed: 3,
    agility: 3,
    energy: 2,
    racks: 3,
    shield: 2,
    armor: 2,
    hull: 3,
    art: "cards/rifter.jpg",
  },
  rupture: {
    id: "rupture",
    name: "Rupture",
    size: "medium",
    speed: 2,
    agility: 2,
    energy: 2,
    racks: 4,
    shield: 3,
    armor: 2,
    hull: 4,
    art: "cards/rupture.jpg",
  },
  tempest: {
    id: "tempest",
    name: "Tempest",
    size: "large",
    speed: 1,
    agility: 1,
    energy: 3,
    racks: 5,
    shield: 4,
    armor: 4,
    hull: 5,
    art: "cards/tempest.jpg",
  },
};

/**
 * Color rank on a movement card. Speed 1 reaches blue, 2 green, 3 yellow.
 * Speed 4, or Overdrive Movement, reaches red.
 */
export const COLORS = [
  { id: "lb", name: "Light Blue", dist: 1, hex: "#7ec8ff" },
  { id: "lg", name: "Light Green", dist: 2, hex: "#9dff6a" },
  { id: "y", name: "Yellow", dist: 3, hex: "#ffe14a" },
  { id: "r", name: "Red", dist: 4, hex: "#ff5a4e" },
];

export const MANEUVERS = [
  "approach",
  "orbitLeft",
  "orbitRight",
  "keep",
  "strafeLeft",
  "strafeRight",
];

export const CARD_COPIES = 2;
export const KEEP_RANGE = 3;

export const MANEUVER_INFO = {
  approach: {
    name: "Approach",
    trans: "low",
    art: "cards/approach.jpg",
    blurb: "Straight forward. Blue 3, green 4, yellow 5, red 6.",
  },
  orbitLeft: {
    name: "Orbit Left",
    trans: "high",
    art: "cards/orbit-left.jpg",
    blurb: "Arc left around the hexes ahead and turn inward. Light blue 3, green 5, yellow 7, red 8.",
  },
  orbitRight: {
    name: "Orbit Right",
    trans: "high",
    art: "cards/orbit-right.jpg",
    blurb: "Arc right around the hexes ahead and turn inward. Light blue 3, green 5, yellow 7, red 8.",
  },
  keep: {
    name: "Keep at Range",
    trans: "low",
    art: "cards/keep.jpg",
    blurb: "Back straight up, nose still forward. Blue 2, green 3, yellow 4, red 5.",
  },
  strafeLeft: {
    name: "Strafe Left",
    trans: "high",
    art: "cards/strafe-left.jpg",
    blurb: "Forward-left. Blue 2, green 3, yellow 4, red 5. Nose stays put.",
  },
  strafeRight: {
    name: "Strafe Right",
    trans: "high",
    art: "cards/strafe-right.jpg",
    blurb: "Forward-right. Blue 2, green 3, yellow 4, red 5. Nose stays put.",
  },
  hold: {
    name: "Hold",
    trans: "low",
    art: "",
    blurb: "Skip the turn. If you survive the shooting, refill energy, +1 shield, and reset modules and Overdrive.",
  },
};

/**
 * Ammo-circle centers on the weapon card art, in the same order as `ammo`.
 * Values are percentages of the card width and height.
 */
export const AMMO_SPOTS = {
  blasters: [[40.4, 77.5], [60.6, 77.5]],
  autocannons: [[19.8, 77.5], [39.9, 77.5], [60.1, 77.5], [80.3, 77.5]],
  rails: [[39.3, 77.6], [59.5, 77.6]],
  artillery: [[29.5, 77.5], [49.7, 77.5], [69.9, 77.5]],
  rockets: [[39.8, 77.5], [60.0, 77.5]],
};

/** Ammo is chosen once per weapon and stays for the match. */
export const AMMO = {
  kinetic: { id: "kinetic", name: "Kinetic", layer: "armor", bonus: "damage" },
  thermal: { id: "thermal", name: "Thermal", layer: "hull", bonus: "damage" },
  explosive: { id: "explosive", name: "Explosive", layer: "hull", bonus: "knock" },
  em: { id: "em", name: "EM", layer: "shield", bonus: "damage" },
};

function fit(slot, cost, extra) {
  return { slot, cost, ...extra };
}

function gun(cost, pattern, extra) {
  const bands = [null, ...pattern];
  const reds = pattern.filter((b) => b && b[0] === "red").map((b) => b[1]);
  return fit("weapon", cost, { ...extra, bands, redDamage: reds.length ? Math.max(...reds) : 0 });
}

const GUN = { small: 2, medium: 2, large: 2 };

export const CATALOG = {
  blasters: gun(GUN, [["red", 4], ["red", 4], ["yellow", 2], null, null, null, null], {
    name: "Blasters",
    ammo: ["thermal", "kinetic"],
    art: "cards/blasters.jpg",
    blurb: "Range 1–2 red 4, range 3 yellow 2.",
  }),
  autocannons: gun(GUN, [["yellow", 2], ["red", 3], ["red", 3], ["yellow", 2], null, null, null], {
    name: "Lasers / Autocannons",
    ammo: ["explosive", "kinetic", "thermal", "em"],
    art: "cards/autocannons.jpg",
    blurb: "Range 1 yellow 2, 2–3 red 3, 4 yellow 2.",
  }),
  rails: gun(GUN, [null, ["yellow", 2], ["red", 3], ["red", 3], ["yellow", 2], null, null], {
    name: "Rails",
    ammo: ["kinetic", "thermal"],
    art: "cards/rails.jpg",
    blurb: "Range 2 yellow 2, 3–4 red 3, 5 yellow 2.",
  }),
  artillery: gun(GUN, [null, null, ["yellow", 2], ["red", 4], ["red", 4], ["yellow", 2], null], {
    name: "Artillery",
    ammo: ["kinetic", "thermal", "explosive"],
    art: "cards/artillery.jpg",
    blurb: "Range 3 yellow 2, 4–5 red 4, 6 yellow 2.",
  }),
  rockets: gun(GUN, [null, ["yellow", 2], ["yellow", 3], ["red", 3], ["yellow", 2], ["yellow", 2], null], {
    name: "Rockets",
    ammo: ["kinetic", "explosive"],
    art: "cards/rockets.jpg",
    blurb: "Range 2 yellow 2, 3 yellow 3, 4 red 3, 5–6 yellow 2.",
  }),
  overcharge: fit("passive", { small: 1, medium: 1, large: 1 }, {
    name: "Weapon Overcharge",
    art: "cards/overcharge.jpg",
    blurb: "When you Overdrive Weapons, yellow bands hit as red.",
  }),
  gyro: fit("passive", { small: 1, medium: 2, large: 2 }, {
    name: "Gyrostabilizer",
    art: "cards/gyro.jpg",
    blurb: "After taking damage, you may slide 1 hex.",
  }),
  rapid: fit("passive", { small: 1, medium: 1, large: 2 }, {
    name: "Rapid Weapons",
    art: "cards/rapid.jpg",
    blurb: "After a red-zone hit, you may fire a different weapon.",
  }),
  neut: fit("active", { small: 1, medium: 1, large: 1 }, {
    name: "Energy Neutralizer", range: 5,
    art: "cards/neut.jpg",
    blurb: "An enemy within 5 loses 1 energy.",
  }),
  web: fit("active", { small: 1, medium: 1, large: 1 }, {
    name: "Stasis Webifier", range: 5,
    art: "cards/web.jpg",
    blurb: "An enemy within 5 loses 1 speed and 1 agility next turn and cannot Overdrive speed.",
  }),
  stealth: fit("active", { small: 2, medium: 2, large: 3 }, {
    name: "Stealth Module",
    art: "cards/stealth.jpg",
    blurb: "Stay put and untargetable this round. The plotted move happens at the end of the next movement.",
  }),
  injector: fit("passive", { small: null, medium: 2, large: 2 }, {
    name: "Overdrive Injector",
    art: "cards/injector.jpg",
    blurb: "+1 speed. A speed of 4 reaches red.",
  }),
  nano: fit("passive", { small: 1, medium: 1, large: 2 }, {
    name: "Nanofiber Structure",
    art: "cards/nano.jpg",
    blurb: "+1 agility.",
  }),
  extender: fit("passive", { small: null, medium: null, large: 2 }, {
    name: "Shield Extender",
    art: "cards/extender.jpg",
    blurb: "+1 max shield to every friendly ship, including this one.",
  }),
  dampener: fit("passive", { small: 1, medium: 1, large: 1 }, {
    name: "Collision Dampeners",
    art: "cards/dampener.jpg",
    blurb: "When you collide, −1 hull damage (minimum 0) and −1 knockback.",
  }),
  ram: fit("passive", { small: 1, medium: 1, large: 1 }, {
    name: "Ramming Array",
    art: "cards/ram.jpg",
    blurb: "When you collide, the other ship takes +1 hull and +1 knockback. You still take normal collision damage.",
  }),
  bomb: fit("active", { small: 2, medium: 2, large: 2 }, {
    name: "Smart Bomb",
    art: "cards/bomb.jpg",
    blurb: "Drop a bomb on the hex behind you. It explodes at the end of the attack phase. Adjacent hexes take 5, the ring beyond takes 2.",
  }),
  repair: fit("passive", { small: 1, medium: 1, large: 1 }, {
    name: "Auxiliary Armor Repairer",
    art: "cards/repair.jpg",
    blurb: "When you Hold and survive, also recover 1 armor.",
  }),
};

export const PILOT_COLORS = [
  { id: "amber", hex: "#ffb020", ink: "#1a1204", name: "Amber" },
  { id: "cyan", hex: "#3ee0ff", ink: "#041018", name: "Cyan" },
  { id: "violet", hex: "#c084fc", ink: "#140818", name: "Violet" },
  { id: "coral", hex: "#ff6b6b", ink: "#1a0808", name: "Coral" },
];

export function shipDef(id) {
  return SHIPS[id] || null;
}

export function sizeRank(size) {
  return SIZE_RANK[size] || 1;
}

export function colorById(id) {
  return COLORS.find((c) => c.id === id) || null;
}

export function rackCost(moduleId, size) {
  const spec = CATALOG[moduleId];
  if (!spec) return null;
  const cost = spec.cost[size];
  return cost == null ? null : cost;
}

export function costLabel(cost) {
  return ["small", "medium", "large"]
    .map((size) => (cost[size] == null ? "–" : String(cost[size])))
    .join("/");
}
