import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// `enabled` (default true) — see useKYCQueue.js's identical convention,
// used the same way by OverviewPanel (gating on listings.moderate).
export function useModerationQueue({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['moderation-queue'],
    queryFn: () => apiFetch('/api/listings/moderation/pending/'),
    enabled,
  })
}
