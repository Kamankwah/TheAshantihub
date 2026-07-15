import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/listing/{id}/ — public, unauthenticated, paginated
// ({count, next, previous, results}) with top-level avg_rating/review_count
// computed via one .aggregate() call (docs plan Phase 2/3 — reviews/qa).
export function useListingReviews(id) {
  return useQuery({
    queryKey: ['listing-reviews', id],
    queryFn: () => apiFetch(`/api/reviews/listing/${id}/`),
    enabled: id != null,
  })
}
