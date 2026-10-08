// Live updates for the staff shell (staff foundations F2/F10). Trades the
// signed-in token for a single-use ticket, opens wss://<api>/ws/staff/,
// reconnects with backoff and hands every `invalidate` list to the caller
// (useRealtime → React Query invalidateQueries). The 60-second polling runs
// regardless; after 30 s without a live socket the status reports `paused`
// so the header can say so.
export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
export const PAUSED_AFTER_MS = 30000

export function realtimeUrl(apiBase, ticket) {
  const origin = apiBase.replace(/\/+$/, '').replace(/^http/, 'ws')
  return `${origin}/ws/staff/?ticket=${encodeURIComponent(ticket)}`
}

export function createRealtimeClient({
  apiBase, getTicket, onInvalidate, onEvent = () => {}, onStatus = () => {},
  createSocket = (url) => new WebSocket(url),
}) {
  let stopped = true
  let socket = null
  let attempt = 0
  let retryTimer = null
  let pauseTimer = null
  let status = { live: false, paused: false }

  const emit = (patch) => {
    const next = { ...status, ...patch }
    if (next.live === status.live && next.paused === status.paused) return
    status = next
    onStatus(status)
  }
  const armPause = () => {
    if (pauseTimer !== null || status.paused) return
    pauseTimer = setTimeout(() => { pauseTimer = null; emit({ paused: true }) }, PAUSED_AFTER_MS)
  }
  const clearPause = () => {
    if (pauseTimer !== null) { clearTimeout(pauseTimer); pauseTimer = null }
  }
  const scheduleRetry = () => {
    if (stopped) return
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
    attempt += 1
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, delay)
  }
  const down = () => {
    socket = null
    emit({ live: false })
    armPause()
    scheduleRetry()
  }

  async function connect() {
    if (stopped) return
    let ticket
    try {
      ticket = await getTicket()
    } catch (error) {
      if (stopped) return
      // 401/403: the session is over; apiClient's 401 handling signs out.
      if (error?.status === 401 || error?.status === 403) { stop(); return }
      down()
      return
    }
    if (stopped) return
    const ws = createSocket(realtimeUrl(apiBase, ticket))
    socket = ws
    ws.onopen = () => {
      if (socket !== ws) return
      attempt = 0
      clearPause()
      emit({ live: true, paused: false })
    }
    ws.onmessage = (message) => {
      if (socket !== ws) return
      let data
      try { data = JSON.parse(message.data) } catch { return }
      // The server closes right after this; onclose reconnects (attempt was
      // already reset by onopen, so there is no backoff to skip).
      if (data?.type === 'force_disconnect') return
      if (Array.isArray(data?.invalidate) && data.invalidate.length) onInvalidate(data.invalidate)
      if (data?.type === 'activity') onEvent(data)
    }
    ws.onerror = () => {} // onclose follows
    ws.onclose = () => { if (socket === ws) down() }
  }

  function start() {
    if (!stopped) return
    stopped = false
    armPause()
    connect()
  }

  function stop() {
    stopped = true
    clearPause()
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    const ws = socket
    socket = null
    if (ws) {
      ws.onclose = null
      try { ws.close() } catch { /* already closed */ }
    }
  }

  return { start, stop, getStatus: () => status }
}
