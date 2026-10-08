import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { API_BASE_URL, apiPost } from '../apiClient.js'
import { createRealtimeClient } from '../lib/realtime.js'

// The staff shell's live connection: each server `invalidate` key refetches
// every query whose key starts with it, through the normal REST endpoints.
export function useRealtime(enabled = true) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState({ live: false, paused: false })
  useEffect(() => {
    if (!enabled) return undefined
    const client = createRealtimeClient({
      apiBase: API_BASE_URL,
      getTicket: () => apiPost('/api/realtime/ticket/', {}).then((data) => data.ticket),
      onInvalidate: (keys) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      onStatus: setStatus,
    })
    client.start()
    return () => client.stop()
  }, [enabled, queryClient])
  return status
}
