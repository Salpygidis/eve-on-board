/** Bots play the same validated orders as a hurried pilot. */

export const BOT_NAMES = ["Drift", "Kite", "Spike", "Lumen"];

export function applyBotAction(game, playerId) {
  return game.forceAction(playerId);
}
