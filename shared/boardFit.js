import { HEX_SIZE } from "./hex.js";

/**
 * How far a water or height piece reaches past the shared edge, as a fraction
 * of the neighbor spacing. A little over 1 lets the piece fill the socket.
 */
export const PIECE_SPAN = 1.05;

/**
 * Uniform scale so a radius-1 piece fills its hex and a bit of the groove.
 */
export function capScaleFor(maxX) {
  const reach = Math.max(maxX, 0.01);
  const limit = (Math.sqrt(3) * PIECE_SPAN) / (2 * reach);
  return HEX_SIZE * Math.min(1, limit);
}

/**
 * Measured on foundation.obj. The rim you stand on is at 4.4. The ledge inside
 * each groove is at 3.3, and the mesh itself continues down to y=0.
 * Water and height pieces are seated on that y=0 base.
 */
export const FOUNDATION_RIM_Y = 4.4;
export const FOUNDATION_FLOOR_Y = 3.3;

/**
 * Measured from public/models/foundation.obj.
 * The plate is a flat-top hex lattice (points toward ±X). Neighbor centers
 * are 38.8622 model units apart. A +30° yaw turns that lattice into the
 * game's pointy-top grid. The offset is the least-squares shift that puts
 * those centers on hexToWorld.
 */
export const FOUNDATION_PITCH = 38.8622;

export function foundationPose() {
  const scale = (HEX_SIZE * Math.sqrt(3)) / FOUNDATION_PITCH;
  return {
    yaw: Math.PI / 6,
    scale,
    x: -0.00073,
    z: -0.00184,
  };
}
