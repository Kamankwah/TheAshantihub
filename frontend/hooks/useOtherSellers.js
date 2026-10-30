import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/catalogue/listings/{id}/other-sellers/?ordering=&lat=&lng= (public).
// lat/lng are sent only when a position is given. A 404 is not retried: the
// panel renders nothing for it.
export function useOtherSellers(listingId, { ordering = 'price', position = null, enabled = true } = {}) {
  return useQuery({
    queryKey: ['catalogue-other-sellers', listingId, ordering, position?.lat ?? null, position?.lng ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ ordering })
      if (position) {
        params.set('lat', String(position.lat))
        params.set('lng', String(position.lng))
      }
      return apiFetch(`/api/catalogue/listings/${listingId}/other-sellers/?${params.toString()}`)
    },
    enabled: enabled && listingId != null,
    retry: false,
  })
}
