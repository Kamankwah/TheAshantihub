import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/ledger/bookings/<sale id>/cancel-quote/ -> {refund: "150.00", whole: false}. What a cancel would refund
// right now, worked out by the server with the same function the cancel uses. Never reused from cache: the amount
// changes as the start time nears.
export function useCancelQuote(saleId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['cancel-quote', saleId],
    queryFn: () => apiFetch(`/api/ledger/bookings/${saleId}/cancel-quote/`),
    enabled: enabled && saleId != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}
