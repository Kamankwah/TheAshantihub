import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/dispatch/ — the dispatch's own assigned deliveries, with
// pickup + drop-off locations (item 11, delivery.dispatch). Paginated.
export function useMyDeliveries({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-deliveries'],
    queryFn: () => apiFetch('/api/orders/dispatch/'),
    enabled,
  })
}
