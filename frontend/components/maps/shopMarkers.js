// Pins for the shops on one delivery, from a tracking payload's `pickups` (several shops) or `pickup` (one shop).
// The shop being worked (the first open one) is gold ("pickup"); later open shops are ringed ("stop"); collected and
// skipped shops are not drawn; a shop without coordinates is not drawn and never faked at 0,0.
const OPEN = ['pending', 'arrived']
const has = (p) => p && p.lat !== null && p.lng !== null && p.lat !== undefined && p.lng !== undefined && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
const open = (data) => (data?.pickups || []).filter((s) => !s.status || OPEN.includes(s.status))

export function shopMarkers(data) {
  const pickups = data?.pickups || []
  if (pickups.length <= 1) {
    const p = data?.pickup
    return has(p) ? [{ id: 'pickup', kind: 'pickup', lat: p.lat, lng: p.lng, label: p.name || 'Shop' }] : []
  }
  const rows = open(data)
  return rows.filter(has).map((s) => ({ id: `stop-${s.sequence}`, kind: s === rows[0] ? 'pickup' : 'stop', lat: s.lat, lng: s.lng, label: `${s.sequence}. ${s.name}` }))
}

// Open shops with no map pin, by name, so a screen can say which ones it cannot draw.
export function unpinnedShops(data) {
  return open(data).filter((s) => !has(s)).map((s) => s.name)
}
