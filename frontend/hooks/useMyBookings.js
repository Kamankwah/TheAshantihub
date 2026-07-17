import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/bookings/mine/ — the customer's own accommodation bookings
// (business item 2 / Wave H3). Plain array.
export function useMyBookings({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => apiFetch('/api/bookings/mine/'),
    enabled,
  })
}
