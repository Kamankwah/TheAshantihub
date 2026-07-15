import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/{id}/ticket-types/mine/ — the event's own organizer's view
// of all their ticket types (active or not), unpaginated
// (EventTicketTypeOwnerSerializer: public fields + quantity_total,
// quantity_sold, is_active, created_at). Mirrors useEventAttendees.js's
// exact `enabled`-gated shape — deliberately not fetched eagerly for every
// event in EventSubmissionPanel's "My Events" list, only once that event's
// "Tickets" panel is actually opened.
export function useMyEventTicketTypes(eventId, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['my-event-ticket-types', eventId],
    queryFn: () => apiFetch(`/api/events/${eventId}/ticket-types/mine/`),
    enabled: eventId != null && enabled,
  })
}
