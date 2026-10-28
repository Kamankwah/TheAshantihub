import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/orders/delivery-preview/?fulfilment= (backend orders/views.py): read from the signed-in customer's cart and
// independent of promotions — {delivery_from, delivered_from, deferred, source}. `deferred` is true when the delivery
// would wait for a closed vendor to open; `source` is "business_hours", "platform" or null. `cartKey` is any string that
// changes when the cart does, so the answer is refetched then. `lat`/`lng` (the chosen delivery pin) are sent only when
// both are set and are part of the key, so an answer is never reused for another pin. The answer also carries `delivery`,
// the cart-quote delivery block ({fee, fee_status, waived, ...}) for door-to-door, or null for store pickup or while
// delivery fees are off. The server decides; screens only show what it says.
export function useDeliveryPreview(fulfilment, { enabled = true, cartKey = '', lat = null, lng = null } = {}) {
  const pin = lat != null && lng != null
  return useQuery({
    queryKey: ['delivery-preview', fulfilment, cartKey, pin ? lat : null, pin ? lng : null],
    queryFn: () => apiFetch(`/api/orders/delivery-preview/?fulfilment=${encodeURIComponent(fulfilment)}${pin ? `&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}` : ''}`),
    enabled,
    retry: false,
  })
}
