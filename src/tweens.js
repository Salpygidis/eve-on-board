export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function tween({ duration = 280, ease = easeOutCubic, onUpdate, onDone }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    function frame(now) {
      const u = Math.min(1, (now - t0) / duration);
      onUpdate(ease(u), u);
      if (u < 1) requestAnimationFrame(frame);
      else {
        onDone?.();
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
