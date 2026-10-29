import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export const DEFAULT_LISTINGS_PATH = '/api/listings/mine'

// The owner's own listings. `basePath` is the owner listing tree: a business uses the default,
// Ashanti Direct's operators pass "/api/direct/listings" (same shapes, same sub-routes).
export function useMyListings(enabled = true, basePath = DEFAULT_LISTINGS_PATH) {
  return useQuery({
    queryKey: basePath === DEFAULT_LISTINGS_PATH ? ['my-listings'] : ['my-listings', basePath],
    queryFn: () => apiFetch(`${basePath}/`),
    enabled,
  })
}
