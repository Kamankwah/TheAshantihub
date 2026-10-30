// Rules and sentences every "share the shop's location" screen has in common (the texted link page and the owner's
// dashboard card). The server enforces the same accuracy rule; the client check only saves a round trip.

// The most uncertainty AshantiHub accepts (metres).
export const MAX_ACCURACY_M = 100

export const tooCoarseMessage = (accuracy) =>
  `Your phone's location is only accurate to ±${accuracy} m. We need ${MAX_ACCURACY_M} m or better: step outside or near a window and try again.`

// A field-keyed 400 ({accuracy_m: ["..."]} or {lat: ["..."]}): the server's own sentence, shown as it is.
export function fieldMessage(error) {
  const body = error?.body
  if (error?.status !== 400 || !body || typeof body !== 'object' || body.code) return ''
  for (const key of ['accuracy_m', 'lat', 'lng']) {
    const value = Array.isArray(body[key]) ? body[key][0] : body[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}
