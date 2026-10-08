import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL, apiPost } from '../apiClient.js'
import { createRealtimeClient } from '../lib/realtime.js'

// The staff shell's live connection: each server `invalidate` key refetches
// every query whose key starts with it, through the normal REST endpoints.
// `onForceDisconnect` (read through a ref, so a new callback never reconnects)
// runs when the server forces a reconnect after a permission or team change.
export function useRealtime(enabled = true, { onForceDisconnect } = {}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState({ live: false, paused: false })
  const forceRef = useRef(onForceDisconnect)
  useEffect(() => { forceRef.current = onForceDisconnect }, [onForceDisconnect])
  useEffect(() => {
    if (!enabled) return undefined
    const client = createRealtimeClient({
      apiBase: API_BASE_URL,
      getTicket: () => apiPost('/api/realtime/ticket/', {}).then((data) => data.ticket),
      onInvalidate: (keys) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      onForceDisconnect: () => forceRef.current?.(),
      onStatus: setStatus,
    })
    client.start()
    return () => client.stop()
  }, [enabled, queryClient])
  return status
}
