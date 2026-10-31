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
    racks: 2,
    damage: 3,
    shield: 3,
    hull: 3,
  },
  rupture: {
    id: "rupture",
    name: "Rupture",
    size: "medium",
    speed: 2,
    agility: 2,
    energy: 2,
    racks: 3,
    damage: 3,
    shield: 4,
    hull: 5,
  },
  tempest: {
    id: "tempest",
    name: "Tempest",
    size: "large",
    speed: 1,
    agility: 1,
    energy: 3,
    racks: 4,
    damage: 4,
    shield: 5,
    hull: 7,
  },
};

/**
 * Distance per color. Speed N may pick a color of distance <= N (capped at 3)
 * without Overdrive. Overdrive Movement adds one color, up to Red (4).
 * Red is never legal unless that extra color is paid for.
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
  approach: { name: "Approach", trans: "low", blurb: "Step toward the focus until you are adjacent." },
  orbitLeft: { name: "Orbit Left", trans: "high", blurb: "Circle the focus, staying at range." },
  orbitRight: { name: "Orbit Right", trans: "high", blurb: "Circle the focus the other way." },
  keep: { name: "Keep at Range", trans: "low", blurb: "Move radially toward distance 3, then stop." },
  strafeLeft: { name: "Strafe Left", trans: "high", blurb: "Slide flat-to-flat, two faces left of your bow." },
  strafeRight: { name: "Strafe Right", trans: "high", blurb: "Slide flat-to-flat, two faces right of your bow." },
  hold: { name: "Hold", trans: "low", blurb: "Spend any card face-down. Refill energy, +1 shield, reset modules and Overdrive." },
};

function fit(slot, cost, extra) {
  return { slot, cost, ...extra };
}

export const CATALOG = {
  blasters: fit("weapon", { small: 1, medium: 1, large: 1 }, {
    name: "Blasters", optimal: 1, falloff: 1, damageType: "Thermal",
    blurb: "Optimal 1, falloff 1. Thermal.",
  }),
  autocannons: fit("weapon", { small: 1, medium: 1, large: 1 }, {
    name: "Autocannons", optimal: 2, falloff: 2, damageType: "Kinetic",
    blurb: "Optimal 2, falloff 2. Kinetic.",
  }),
  rails: fit("weapon", { small: 1, medium: 1, large: 2 }, {
    name: "Rails", optimal: 4, falloff: 2, damageType: "Kinetic",
    blurb: "Optimal 4, falloff 2. Kinetic.",
  }),
  artillery: fit("weapon", { small: null, medium: 2, large: 2 }, {
    name: "Artillery", optimal: 5, falloff: 1, damageType: "Explosive",
    blurb: "Optimal 5, falloff 1. Explosive. No small ships.",
  }),
  rockets: fit("weapon", { small: 1, medium: 1, large: 1 }, {
    name: "Rockets", optimal: 3, falloff: 3, damageType: "Explosive",
    blurb: "Optimal 3, falloff 3. Explosive.",
  }),
  overcharge: fit("active", { small: 1, medium: 1, large: 1 }, {
    name: "Weapon Overcharge",
    blurb: "With Weapons Overdrive, a yellow hit counts as red.",
  }),
  gyro: fit("passive", { small: 1, medium: 2, large: 2 }, {
    name: "Gyrostabilizer",
    blurb: "After taking damage, slide 1 hex if you can.",
  }),
  rapid: fit("passive", { small: 1, medium: 1, large: 2 }, {
    name: "Rapid Weapons",
    blurb: "After a red hit, you may fire a second weapon.",
  }),
  neut: fit("active", { small: 1, medium: 1, large: 1 }, {
    name: "Energy Neutralizer", range: 5,
    blurb: "An enemy within 5 loses 1 energy.",
  }),
  web: fit("active", { small: 1, medium: 1, large: 1 }, {
    name: "Stasis Webifier", range: 5,
    blurb: "An enemy within 5 loses 1 speed and 1 agility next turn and cannot Overdrive Movement.",
  }),
  stealth: fit("active", { small: 1, medium: 2, large: null }, {
    name: "Stealth Module",
    blurb: "Hide the move. You cannot be targeted this activation.",
  }),
  injector: fit("passive", { small: null, medium: 2, large: 2 }, {
    name: "Overdrive Injector",
    blurb: "+1 speed. Medium and large only.",
  }),
  nano: fit("passive", { small: 1, medium: 1, large: 2 }, {
    name: "Nanofiber Structure",
    blurb: "+1 agility.",
  }),
  extender: fit("passive", { small: null, medium: null, large: 2 }, {
    name: "Shield Extender",
    blurb: "+1 max shield to every friendly ship, including this one.",
  }),
  dampener: fit("passive", { small: 1, medium: 1, large: 1 }, {
    name: "Collision Dampeners",
    blurb: "−1 collision damage (minimum 0) and −1 knockback.",
  }),
  ram: fit("passive", { small: 1, medium: 1, large: 1 }, {
    name: "Ramming Array",
    blurb: "The other ship takes +1 collision damage and +1 knockback.",
  }),
  bomb: fit("active", { small: 1, medium: 1, large: 1 }, {
    name: "Smart Bomb",
    blurb: "Mine your current hex. It blows after movement if another ship is there. You do not set it off on the turn you drop it.",
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
