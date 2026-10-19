import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/ledger/booking-terms/ — public. The hours that govern when a service, stay or ticket sale is paid out
// (read from the money settings in force now), the stay check-in time, and the cancellation policies a vendor can
// choose from. Checkout screens read this so none of them carries its own copy of those numbers.
export function useBookingTerms() {
  return useQuery({
    queryKey: ['booking-terms'],
    queryFn: () => apiFetch('/api/ledger/booking-terms/'),
    staleTime: 5 * 60 * 1000,
  })
}
