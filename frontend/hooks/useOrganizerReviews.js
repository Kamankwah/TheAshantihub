import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/organizer/{kind}/{id}/ — public, unauthenticated,
// paginated ({count, next, previous, results}) with top-level
// avg_rating/review_count. `kind` is "business" or "customer" (an event
// organizer can be either), mirroring EventDetailSerializer's
// `organizer: {kind, id, full_name}` field.
export function useOrganizerReviews(kind, id) {
  return useQuery({
    queryKey: ['organizer-reviews', kind, id],
    queryFn: () => apiFetch(`/api/reviews/organizer/${kind}/${id}/`),
    enabled: kind != null && id != null,
  })
}
