import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Mirrors useHeroModerationQueue.js's shape exactly, for the staff-facing
// subscription plan approval queue (subscription_plans.approve permission —
// super_admin only). Lists only status="pending_approval" plans, plain array
// (not paginated).
export function useSubscriptionPlanPendingQueue() {
  return useQuery({
    queryKey: ['subscription-plan-pending-queue'],
    queryFn: () => apiFetch('/api/billing/plans/pending/'),
  })
}
