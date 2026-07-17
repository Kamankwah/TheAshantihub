import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/services/requests/mine/ — the customer's own service requests
// (business item 2 / Wave H2). Plain array.
export function useMyServiceRequests({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['my-service-requests'],
    queryFn: () => apiFetch('/api/services/requests/mine/'),
    enabled,
  })
}
