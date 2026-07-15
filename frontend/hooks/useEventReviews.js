import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/event/{id}/ — public, unauthenticated, paginated
// ({count, next, previous, results}) with top-level avg_rating/review_count.
export function useEventReviews(id) {
  return useQuery({
    queryKey: ['event-reviews', id],
    queryFn: () => apiFetch(`/api/reviews/event/${id}/`),
    enabled: id != null,
  })
}
