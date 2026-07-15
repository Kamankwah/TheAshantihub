import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/{id}/ticket-types/ — public, unauthenticated list of a
// *live* event's active ticket types (EventTicketTypePublicSerializer:
// id, name, description, price, delivery_method, quantity_remaining).
// Mirrors useEvent.js's shape (single-resource query keyed on the event id,
// enabled only once an id is known).
export function useEventTicketTypes(id) {
  return useQuery({
    queryKey: ['event-ticket-types', id],
    queryFn: () => apiFetch(`/api/events/${id}/ticket-types/`),
    enabled: id != null,
  })
}
