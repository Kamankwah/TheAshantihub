import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/{id}/rsvps/ — organizer-only (the event's own submitter)
// or staff holding `event.approve`; a paginated (DRF PageNumberPagination —
// {count, next, previous, results}) list of "going" attendees
// (customer_name, customer_phone, customer_email, status, rsvp_at), per
// docs/BUSINESS_EVENTS_ROADMAP.md Phase 7. Deliberately *not* fetched
// eagerly for every event in EventSubmissionPanel's "My Events" list —
// `enabled` defaults to false so a caller only fires this once the
// organizer actually opens the "Attendees" view for a specific event.
export function useEventAttendees(eventId, { enabled = false } = {}) {
  return useQuery({
    queryKey: ['event-attendees', eventId],
    queryFn: () => apiFetch(`/api/events/${eventId}/rsvps/`),
    enabled: eventId != null && enabled,
  })
}
