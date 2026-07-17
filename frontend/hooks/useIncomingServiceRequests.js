import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/services/requests/incoming/ — a service business's incoming request
// queue (business item 2 / Wave H2). Plain array.
export function useIncomingServiceRequests({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['incoming-service-requests'],
    queryFn: () => apiFetch('/api/services/requests/incoming/'),
    enabled,
  })
}
