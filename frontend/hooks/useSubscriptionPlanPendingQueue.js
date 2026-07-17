import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/billing/plans/pending/?status=pending|approved|rejected — mirrors
// useHeroModerationQueue.js's shape, for the staff-facing subscription plan
// approval queue (subscription_plans.approve permission — super_admin only).
// Plain array, not paginated. The path keeps its historical "pending"
// segment; the tab is the query param. Note "approved" maps to this model's
// `active` status server-side — an approved plan is a live one.
export function useSubscriptionPlanPendingQueue({ status = 'pending', enabled = true } = {}) {
  return useQuery({
    queryKey: ['subscription-plan-pending-queue', status],
    queryFn: () => apiFetch(`/api/billing/plans/pending/?status=${status}`),
    enabled,
  })
}
