import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/scout-assignments/mine/ — a scout's own field-verification
// queue (item 11, scouts.verify). Plain array.
export function useMyScoutAssignments({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-scout-assignments'],
    queryFn: () => apiFetch('/api/accounts/scout-assignments/mine/'),
    enabled,
  })
}
