import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/owner/ — a business owner's own sales: PAID orders containing
// their listings, exposing only their own line items plus the delivery method /
// status the owner needs to see fulfilment progress. Paginated (DRF envelope),
// so consumers read `data?.results` — same gotcha as the staff queue hooks.
export function useOwnerOrders(enabled = true) {
  return useQuery({
    queryKey: ['owner-orders'],
    queryFn: () => apiFetch('/api/orders/owner/'),
    enabled,
  })
}
