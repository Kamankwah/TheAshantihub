// Rules and sentences every "share the shop's location" screen has in common (the texted link page and the owner's
// dashboard card). The server enforces the same accuracy rule; the client check only saves a round trip.

// The most uncertainty AshantiHub accepts (metres).
export const MAX_ACCURACY_M = 100

// The accuracy staff need before they can verify the shop (the evidence ladder). A fix between this and MAX_ACCURACY_M
// is accepted by the server but can never satisfy the ladder, so the owner is warned before it uses up their share.
export const VERIFY_ACCURACY_M = 50

// Beyond this the phone is almost surely giving an approximate location (Android "Approximate", iOS Precise Location
// off), which stepping outside cannot fix.
const APPROXIMATE_ABOVE_M = 500

export const tooCoarseMessage = (accuracy) =>
  `Your phone's location is only accurate to ±${accuracy} m. We need ${MAX_ACCURACY_M} m or better: step outside or near a window and try again.` +
  (accuracy > APPROXIMATE_ABOVE_M ? " If it stays this far off, turn on Precise location for your browser in your phone's settings." : '')

// 50 m < accuracy <= 100 m: usable by the server, too loose to verify the shop.
export const isWeakFix = (accuracy) => accuracy > VERIFY_ACCURACY_M && accuracy <= MAX_ACCURACY_M

export const weakFixMessage = (accuracy) =>
  `Your location is accurate to ±${accuracy} m. AshantiHub needs ${VERIFY_ACCURACY_M} m or better to verify your shop: step outside and try again.`

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
