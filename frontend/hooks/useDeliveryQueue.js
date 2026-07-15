import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/staff/ — staff-only (orders.manage_delivery permission),
// backing StaffDashboard's "Delivery Management" tab. Paginated
// ({count, next, previous, results}), same gotcha as
// useReviewsModerationQueue.js — callers must read `data?.results`, not
// `data` directly.
export function useDeliveryQueue() {
  return useQuery({
    queryKey: ['delivery-queue'],
    queryFn: () => apiFetch('/api/orders/staff/'),
  })
}
