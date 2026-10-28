// Trusted-device token and small helpers for the sign-in code flow.
// The device token is the one OTP secret allowed in browser storage, in its
// own key, so a customer who trusted this browser skips the code next time.
// Storage can throw (private windows, blocked site data): every access is
// wrapped and degrades to "no token".
export const DEVICE_KEY = 'ashantihub.deviceToken'

export function getDeviceToken() {
  try {
    return localStorage.getItem(DEVICE_KEY) || null
  } catch {
    return null
  }
}

export function setDeviceToken(token) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token)
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Not trusted on this browser; the next sign-in simply asks for a code.
  }
}

export function clearDeviceToken() {
  try {
    localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Nothing to clear.
  }
}

// A sign-in or sign-up answer that wants a code instead of giving a token.
export const isOtpChallenge = (r) => Boolean(r && !r.token && (r.otp_required || r.two_factor_required))

// The server's machine-readable reason on a 400/409/429/502 body.
export const otpCode = (err) => err?.body?.code
