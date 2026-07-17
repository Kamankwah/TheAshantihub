import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/bookings/incoming/ — an accommodation business's bookings (business
// item 2 / Wave H3). Plain array.
export function useIncomingBookings({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['incoming-bookings'],
    queryFn: () => apiFetch('/api/bookings/incoming/'),
    enabled,
  })
}
