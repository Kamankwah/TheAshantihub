import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/tickets/mine/ — the signed-in customer's own purchased
// tickets, unpaginated (TicketSerializer, plain array — mirrors
// useOrders.js/useMyEvents.js's "own data isn't paginated" convention).
export function useMyTickets() {
  return useQuery({
    queryKey: ['my-tickets'],
    queryFn: () => apiFetch('/api/events/tickets/mine/'),
  })
}
