import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/scouts/ — active scout staff, so the assign UI can pick
// one (item 11, scouts.assign). Plain array.
export function useScouts({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['scouts'],
    queryFn: () => apiFetch('/api/accounts/scouts/'),
    enabled,
  })
}
