import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/{id}/tickets/checkin-list/ — organizer/staff-only (same
// gate as GET .../rsvps/), paginated ({count, next, previous, results})
// roster of every ticket sold for this event (TicketCheckinListSerializer).
// Same `enabled`-gated shape as useEventAttendees.js — only fetched once the
// event's "Check-in" panel is actually opened.
export function useEventCheckinList(eventId, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['event-checkin-list', eventId],
    queryFn: () => apiFetch(`/api/events/${eventId}/tickets/checkin-list/`),
    enabled: eventId != null && enabled,
  })
}
