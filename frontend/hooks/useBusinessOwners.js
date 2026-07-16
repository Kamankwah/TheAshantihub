import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// `enabled` (default true) — see useKYCQueue.js's identical convention,
// used the same way by OverviewPanel (gating on users.view).
export function useBusinessOwners({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['staff-business-owners'],
    queryFn: () => apiFetch('/api/accounts/business-owners/'),
    enabled,
  })
}
