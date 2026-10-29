import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/listings/<id>/also-viewed/?limit=12 — public. An object, not a DRF
// envelope: {basis: "co_viewed" | "same_category", results: [card rows]}.
// `basis` decides the carousel heading ("Customers also viewed" only for
// co_viewed); `results` may be empty.
export function useAlsoViewed(id) {
  return useQuery({
    queryKey: ['listing-also-viewed', id],
    queryFn: () => apiFetch(`/api/listings/${id}/also-viewed/?limit=12`),
    enabled: id != null,
  })
}
