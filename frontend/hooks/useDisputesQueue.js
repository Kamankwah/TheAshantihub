import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/disputes/ — the staff dispute queue (disputes app), viewable by a
// session holding EITHER disputes.flag OR disputes.resolve_financial.
// Paginated ({count, next, previous, results}), same convention as
// useReviewsModerationQueue.js/useEscrowLedger.js — callers must read
// `data?.results`, not `data` directly.
// `enabled` (default true) — see useKYCQueue.js's identical convention,
// used the same way by OverviewPanel (gating on disputes.flag||
// disputes.resolve_financial).
export function useDisputesQueue({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['disputes-queue'],
    queryFn: () => apiFetch('/api/disputes/'),
    enabled,
  })
}
