import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The signed-in business owner's own shop pin and address-check status (GET /api/accounts/me/location/):
// { pin: null | {lat, lng, accuracy_m, set_by, set_at, is_manual}, address_status: 'not_verified' | 'verified' | 'wrong',
//   wrong_reason: string | null, can_capture: boolean }. Saving a fix is POST to the same URL, done in the card's own
// handler followed by this query's refetch().
export const MY_LOCATION_URL = '/api/accounts/me/location/'

export function useMyShopLocation(enabled = true) {
  return useQuery({
    queryKey: ['my-shop-location'],
    queryFn: () => apiFetch(MY_LOCATION_URL),
    enabled,
  })
}
