import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// Re-delivery at the customer's request (Plan 7F-E Task 7). GET /api/delivery/redeliveries/?order=<id>
// lists an order's requests, newest first ({results}, unpaginated); it needs orders.redeliver
// (Support, the Pickup Desk, a Super Admin). Pass enabled=false for staff without it.
export function useOrderRedeliveries(orderId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['redeliveries', String(orderId)],
    queryFn: () => apiFetch(`/api/delivery/redeliveries/?order=${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId) && enabled,
  })
}
