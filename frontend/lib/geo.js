// Great-circle distance between two points, in metres (haversine).
export function distanceM(lat1, lng1, lat2, lng2) {
  const rad = (deg) => (deg * Math.PI) / 180
  const dPhi = rad(lat2 - lat1)
  const dLambda = rad(lng2 - lng1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLambda / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

// "38 m" below a kilometre, "1.2 km" above.
export function formatDistance(metres) {
  if (metres == null || !Number.isFinite(metres)) return ''
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`
}
