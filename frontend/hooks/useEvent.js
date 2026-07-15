import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/events/{id}/ — may return either the full detail shape or the
// safe teaser subset, depending on the event's access_level and whether it
// has already been unlocked server-side for this request (it hasn't — this
// endpoint takes no code param; EventDetailPage.jsx unlocks via a separate
// POST /api/events/{id}/unlock/ call and keeps the unlocked detail in local
// state rather than re-querying this hook with a code). See
// EventDetailPage.jsx for how the ambiguity between the two response shapes
// is resolved.
export function useEvent(id) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => apiFetch(`/api/events/${id}/`),
    enabled: id != null,
  })
}
