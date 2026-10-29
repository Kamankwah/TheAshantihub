import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'
import { DEFAULT_LISTINGS_PATH } from './useMyListings.js'

// The open edit (draft or waiting) or the last rejected one of an approved listing, or null when
// there is none (the server answers 404 then). Mutations stay plain apiPut/apiPost/apiDelete in
// the components that own the buttons; they call `refetch` here and the listing's own refetch.
export function useListingRevision(listingId, { basePath = DEFAULT_LISTINGS_PATH, enabled = true } = {}) {
  return useQuery({
    queryKey: ['listing-revision', basePath, listingId],
    enabled: enabled && listingId != null,
    retry: false,
    queryFn: async () => {
      try {
        return await apiFetch(`${basePath}/${listingId}/revision/`)
      } catch (err) {
        if (err?.status === 404) return null
        throw err
      }
    },
  })
}
