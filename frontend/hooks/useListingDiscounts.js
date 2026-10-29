import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiPost } from '../apiClient.js'
import { DEFAULT_LISTINGS_PATH } from './useMyListings.js'

// The live discounts of one owner listing and its variants (the server derives them; expired ones are not listed):
// [{target: 'listing'|'variant', variant: id|null, label, regular_price, sale_price, percent_off, ends_at|null}].
// `basePath` is the owner listing tree (Ashanti Direct's operators pass "/api/direct/listings").
// Mutations stay plain apiPost calls: start with {variant?, sale_price | percent_off, ends_at?} (answers the list),
// end with {variant?}. A refusal is a 400 (rule) or 409 (a discount already runs) with {detail}.
export function useListingDiscounts(listingId, basePath = DEFAULT_LISTINGS_PATH) {
  return useQuery({
    queryKey: ['listing-discounts', basePath, listingId],
    enabled: listingId != null,
    queryFn: () => apiFetch(`${basePath}/${listingId}/discounts/`),
  })
}

export const startListingDiscount = (listingId, body, basePath = DEFAULT_LISTINGS_PATH) =>
  apiPost(`${basePath}/${listingId}/discounts/`, body)

export const endListingDiscount = (listingId, body = {}, basePath = DEFAULT_LISTINGS_PATH) =>
  apiPost(`${basePath}/${listingId}/discounts/end/`, body)
