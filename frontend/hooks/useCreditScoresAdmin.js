import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/credit/scores/ — every business owner's (naive placeholder) credit
// score, staff-only (analytics.view OR credit.manage). Plain array, computed
// fresh server-side on each request. Backs the admin Credit panel (item 16).
export function useCreditScoresAdmin({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['credit-scores-admin'],
    queryFn: () => apiFetch('/api/credit/scores/'),
    enabled,
  })
}
