import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/disputes/?status=pending|approved|rejected — the staff dispute
// queue (disputes app), viewable by a session holding EITHER disputes.flag OR
// disputes.resolve_financial.
//
// The tab maps four statuses onto three: "pending" is open+investigating
// (both still being worked), "approved" is resolved, "rejected" is rejected.
// Defaults to pending, so OverviewPanel's "Open disputes" KPI can read
// `data.count` directly.
//
// Paginated ({count, next, previous, results}), same convention as
// useReviewsModerationQueue.js/useEscrowLedger.js — callers must read
// `data?.results`, not `data` directly.
// `enabled` (default true) — see useKYCQueue.js's identical convention,
// used the same way by OverviewPanel (gating on disputes.flag||
// disputes.resolve_financial).
// `order` (optional) narrows the queue to one order's disputes (Support's
// intake deep link, `?order=`).
export function useDisputesQueue({ status = 'pending', enabled = true, order = '' } = {}) {
  return useQuery({
    queryKey: order ? ['disputes-queue', status, `order-${order}`] : ['disputes-queue', status],
    queryFn: () => apiFetch(`/api/disputes/?status=${status}${order ? `&order=${encodeURIComponent(order)}` : ''}`),
    enabled,
  })
}
