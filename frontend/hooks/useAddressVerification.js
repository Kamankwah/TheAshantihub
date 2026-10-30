import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/address-verification/?status=pending|verified|wrong&page=N —
// the staff address-verification queue (permission address.verify). PAGINATED
// ({count, next, previous, results}), so callers read `data?.results`.
// The query key starts with "address-verification", the key the realtime
// channel invalidates (backend QUEUE_INVALIDATIONS), so a captured location or
// a decision elsewhere refetches the open tab without a reload.
export function useAddressVerification({ status = 'pending', page = 1, enabled = true } = {}) {
  return useQuery({
    queryKey: ['address-verification', status, page],
    queryFn: () => apiFetch(`/api/accounts/address-verification/?status=${status}&page=${page}`),
    enabled,
  })
}
