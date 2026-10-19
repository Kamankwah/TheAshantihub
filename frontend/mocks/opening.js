import { http, HttpResponse } from 'msw'

export const OPENING_URL = 'http://localhost:8000/api/storefront/opening/'

// The default (mocks/handlers.js) is the gate switched off: open, so nothing
// existing changes. A test that needs the countdown or the disabled buy state
// installs this with server.use(gatedOpening(...)).
// `opensAt` is an ISO string; `serverNow` defaults to the real current time
// of each request, as the server would report it.
export function gatedOpening({ opensAt, serverNow } = {}) {
  return http.get(OPENING_URL, () => {
    const now = serverNow ?? new Date().toISOString()
    return HttpResponse.json({
      opens_at: opensAt,
      server_now: now,
      is_open: Date.parse(now) >= Date.parse(opensAt),
      gate_enabled: true,
    })
  })
}
