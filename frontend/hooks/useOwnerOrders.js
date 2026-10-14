import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

const POLL_MS = 30000

// Poll only while the data shows a door-to-door order still in 'processing' (the only window the pickup code matters; failed, shipped or
// delivered orders stop the poll), so the owner's
// pickup code appears (and clears) without a manual reload. A shop with nothing on the road
// makes no extra requests. Exported as a pure helper so it can be unit-tested.
export function ownerOrdersInterval(data) {
  const active = (data?.results || []).some((o) => (
    o.rider_heading_here === true
    || (o.pickup_code != null && o.pickup_code !== '')
    || (o.delivery_method === 'door_to_door' && o.delivery_status === 'processing')
  ))
  return active ? POLL_MS : false
}

// GET /api/orders/owner/ — a business owner's own sales: PAID orders containing
// their listings, exposing only their own line items plus the delivery method /
// status the owner needs to see fulfilment progress. Paginated (DRF envelope),
// so consumers read `data?.results` — same gotcha as the staff queue hooks.
export function useOwnerOrders(enabled = true) {
  return useQuery({
    queryKey: ['owner-orders'],
    queryFn: () => apiFetch('/api/orders/owner/'),
    enabled,
    refetchInterval: (query) => ownerOrdersInterval(query.state.data),
    refetchIntervalInBackground: false,
  })
}
