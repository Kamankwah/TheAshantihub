// Why the staff shell signed someone out, carried across the sign-out to the
// staff sign-in form (sessionStorage: this tab only, read once).
const KEY = 'ashantihub.signedOutReason'

export const SIGNED_OUT_MESSAGES = {
  idle: 'You were signed out after 30 minutes without activity.',
  ended: 'Your session ended. Sign in again to carry on.',
}

export function noteSignedOutReason(reason) {
  try { sessionStorage.setItem(KEY, reason) } catch { /* storage unavailable */ }
}

export function takeSignedOutMessage() {
  try {
    const reason = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return SIGNED_OUT_MESSAGES[reason] || null
  } catch {
    return null
  }
}
