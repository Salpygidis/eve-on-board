/** Short hover copy for a hex. The scene asks for this after a long press. */

export function describeHex(state, q, r) {
  const lines = [{ text: `Hex ${q}, ${r}` }];
  const ships = (state?.ships || []).filter((s) => s.q === q && s.r === r);
  for (const ship of ships) {
    const pilot = state.players?.find((p) => p.id === ship.playerId);
    const who = pilot ? `${pilot.name}'s ` : "";
    lines.push({
      text: `${who}${ship.name} · shield ${ship.shield}/${ship.shieldMax} · armor ${ship.armor || 0}/${ship.armorMax || 0} · hull ${ship.hullHp}/${ship.hullMax}`,
    });
  }
  for (const bomb of state?.bombs || []) {
    if (bomb.q === q && bomb.r === r) lines.push({ text: `Smart bomb · ${bomb.ownerName}` });
  }
  if (lines.length === 1) lines.push({ text: "Empty space" });
  return lines;
}

export function showHexTip(lines, x, y) {
  const tip = document.getElementById("hex-tip");
  if (!tip) return;
  tip.innerHTML = lines.map((line) => `<p>${escapeHtml(line.text)}</p>`).join("");
  tip.style.left = `${Math.min(x + 12, window.innerWidth - 220)}px`;
  tip.style.top = `${Math.min(y + 12, window.innerHeight - 80)}px`;
  tip.classList.remove("hidden");
}

export function hideHexTip() {
  document.getElementById("hex-tip")?.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
