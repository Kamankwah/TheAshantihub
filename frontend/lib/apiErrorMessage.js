// Best-effort human message from a thrown apiClient error (error.body is the
// parsed DRF JSON or null). Falls back to the caller's generic text.
export function apiErrorMessage(err, fallback) {
  const body = err?.body
  if (!body || typeof body !== 'object') return fallback
  if (typeof body.detail === 'string' && body.detail) return body.detail
  for (const value of Object.values(body)) {
    const first = Array.isArray(value) ? value[0] : value
    if (typeof first === 'string' && first) return first
  }
  return fallback
}
