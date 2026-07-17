import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/delivery/ — paid door-to-door orders for the Delivery
// Manager to assign a dispatch to (item 11, delivery.manage). Paginated.
export function useDeliveryManagerOrders({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['delivery-manager-orders'],
    queryFn: () => apiFetch('/api/orders/delivery/'),
    enabled,
  })
}
