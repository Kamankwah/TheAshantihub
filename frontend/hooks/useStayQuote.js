import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/bookings/availability/?listing=&check_in=&check_out=&units= — NOT
// paginated: a plain object `{units_free, available, nights, nightly_rate,
// units, total_price}`, where `total_price` is the server's GH₵ string for the
// whole stay (nightly rate x nights x units) or null when the listing has no
// nightly rate. Asked only when `enabled` (the page passes: dates set and the
// wallet ledger on), so a ledger-off page makes no new request.
export function useStayQuote({ listingId, checkIn, checkOut, units, enabled = true } = {}) {
  return useQuery({
    queryKey: ['stay-quote', listingId, checkIn, checkOut, units],
    queryFn: () => apiFetch(
      `/api/bookings/availability/?listing=${encodeURIComponent(listingId)}&check_in=${encodeURIComponent(checkIn)}&check_out=${encodeURIComponent(checkOut)}&units=${encodeURIComponent(units)}`,
    ),
    enabled: !!enabled && listingId != null && !!checkIn && !!checkOut,
  })
}
