// Hover-zoom geometry. `box` is the displayed image box {w,h}; `cursor` is the
// pointer position inside it {x,y}; `pane` is the zoom pane size {w,h}.
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

// The region of the image the pane shows: pane / zoom in size, centred on the
// cursor, kept fully inside the box.
export function lensRect(box, cursor, zoom, pane) {
  const w = Math.min(pane.w / zoom, box.w)
  const h = Math.min(pane.h / zoom, box.h)
  return {
    x: clamp(cursor.x - w / 2, 0, box.w - w),
    y: clamp(cursor.y - h / 2, 0, box.h - h),
    w,
    h,
  }
}

// Translation to apply to the box-sized-times-zoom image in the pane.
export function paneOffset(lens, _box, zoom) {
  return { x: -lens.x * zoom || 0, y: -lens.y * zoom || 0 }
}
