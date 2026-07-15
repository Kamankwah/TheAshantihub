import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reviews/seller/{businessOwnerId}/ — public, unauthenticated,
// paginated ({count, next, previous, results}) with top-level
// avg_rating/review_count — a business owner's own "seller rating", not an
// aggregate of their listings' reviews.
export function useOwnerReviews(businessOwnerId) {
  return useQuery({
    queryKey: ['owner-reviews', businessOwnerId],
    queryFn: () => apiFetch(`/api/reviews/seller/${businessOwnerId}/`),
    enabled: businessOwnerId != null,
  })
}
