// Pure helpers between Leaflet's [lat, lng] points and the backend's zone boundary: an OPEN ring
// of [lng, lat] points (the backend's point_in_ring wraps round implicitly and the model says the
// first point need not repeat). Fewer than 3 distinct points is not a shape.
const pair = (p) => {
  const a = Array.isArray(p) ? [p[0], p[1]] : [p?.lat, p?.lng]
  const lat = Number(a[0]); const lng = Number(a[1])
  return a[0] === null || a[0] === undefined || a[1] === null || a[1] === undefined || !Number.isFinite(lat) || !Number.isFinite(lng) ? null : [lat, lng]
}
const dropClosing = (pts) => (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts)
const distinct = (pts) => new Set(pts.map((p) => `${p[0]},${p[1]}`)).size

// Leaflet latlngs ([lat, lng] pairs or {lat, lng}) -> [[lng, lat], ...], or null if not a shape.
export function ringFromLatLngs(latlngs) {
  if (!Array.isArray(latlngs)) return null
  const pts = latlngs.map(pair)
  if (pts.some((p) => p === null)) return null
  const open = dropClosing(pts)
  if (open.length < 3 || distinct(open) < 3) return null
  return open.map(([lat, lng]) => [lng, lat])
}

// Backend ring [[lng, lat], ...] -> [[lat, lng], ...]; null or invalid -> [].
export function latLngsFromRing(ring) {
  if (!Array.isArray(ring)) return []
  const pts = ring.map((p) => { const q = pair(Array.isArray(p) ? [p[1], p[0]] : null); return q })
  if (pts.some((p) => p === null)) return []
  const open = dropClosing(pts)
  return open.length < 3 ? [] : open
}
