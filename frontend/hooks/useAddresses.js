import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// The signed-in customer's address book. GET /api/accounts/addresses/ is a
// PLAIN ARRAY (default first, then newest; at most 10) - NOT a paginated
// envelope, so read `data` directly, never `data.results`.
export const ADDRESSES_KEY = ['addresses']

export function useAddresses(enabled = true) {
  return useQuery({
    queryKey: ADDRESSES_KEY,
    queryFn: () => apiFetch('/api/accounts/addresses/'),
    enabled,
  })
}
