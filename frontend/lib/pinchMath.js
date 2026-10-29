// Pinch-zoom / pan / swipe geometry for the phone gallery (no gesture library).
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

export function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

// Scale follows the ratio of the current finger distance to the starting one.
export function nextScale(startScale, startDistance, currentDistance, { min = 1, max = 4 } = {}) {
  if (!(startDistance > 0)) return clamp(startScale, min, max)
  return clamp(startScale * (currentDistance / startDistance), min, max)
}

// Pan is the translation (screen px) applied before scaling about the centre.
// The scaled image overflows its box by box * (scale - 1) / 2 on each side.
export function clampPan(pan, scale, box) {
  const mx = (box.w * (scale - 1)) / 2
  const my = (box.h * (scale - 1)) / 2
  return { x: clamp(pan.x, -mx, mx) || 0, y: clamp(pan.y, -my, my) || 0 }
}

// A swipe is a mostly-horizontal drag of at least minDx, and only unzoomed
// (when zoomed, a drag pans the image instead).
export function isSwipe(dx, dy, { minDx = 50, scale = 1 } = {}) {
  if (scale > 1) return false
  return Math.abs(dx) >= minDx && Math.abs(dx) > Math.abs(dy)
}
