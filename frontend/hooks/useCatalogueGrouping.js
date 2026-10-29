import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/catalogue/mine/{id}/ -> {listing, groupable, barcode, store_code,
// catalogue_product, request}. Owner-only.
export function useGroupingState(listingId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['catalogue-mine', listingId],
    queryFn: () => apiFetch(`/api/catalogue/mine/${listingId}/`),
    enabled: enabled && listingId != null,
  })
}
