import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// `status` (default "pending") selects the three-state moderation tab
// (pending/approved[=published]/rejected) via the backend's `?status=` param
// (staff moderation-queue restructuring). `enabled` (default true) — see
// useKYCQueue.js's identical convention, used the same way by OverviewPanel
// (gating on listings.moderate).
export function useModerationQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['moderation-queue', status],
    queryFn: () => apiFetch(`/api/listings/moderation/pending/?status=${status}`),
    enabled,
  })
}
