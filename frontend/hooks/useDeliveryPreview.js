import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/delivery-preview/?fulfilment= (backend orders/views.py): read from the signed-in customer's cart and
// independent of promotions — {delivery_from, delivered_from, deferred, source}. `deferred` is true when the delivery
// would wait for a closed vendor to open; `source` is "business_hours", "platform" or null. `cartKey` is any string that
// changes when the cart does, so the answer is refetched then. The server decides; screens only show what it says.
export function useDeliveryPreview(fulfilment, { enabled = true, cartKey = '' } = {}) {
  return useQuery({
    queryKey: ['delivery-preview', fulfilment, cartKey],
    queryFn: () => apiFetch(`/api/orders/delivery-preview/?fulfilment=${encodeURIComponent(fulfilment)}`),
    enabled,
    retry: false,
  })
}
