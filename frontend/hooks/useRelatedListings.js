import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/listings/{id}/related/ — public, unauthenticated. Other published
// listings sharing the anchor listing's category and/or zone, for the PDP's
// "Related" rail (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3). Not paginated —
// the backend caps this at a fixed small count instead.
export function useRelatedListings(id) {
  return useQuery({
    queryKey: ['listing-related', id],
    queryFn: () => apiFetch(`/api/listings/${id}/related/`),
    enabled: id != null,
  })
}
