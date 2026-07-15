import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Mirrors useHeroModerationQueue.js's shape exactly, for the staff-facing
// subscription plans management list (subscription_plans.manage permission —
// accountant + super_admin). Lists ALL plans regardless of status, plain
// array (not paginated).
export function useSubscriptionPlansManageQueue() {
  return useQuery({
    queryKey: ['subscription-plans-manage-queue'],
    queryFn: () => apiFetch('/api/billing/plans/manage/'),
  })
}
