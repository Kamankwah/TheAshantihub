import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useListing(id) {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: () => apiFetch(`/api/listings/${id}/`),
    enabled: id != null,
  })
}
