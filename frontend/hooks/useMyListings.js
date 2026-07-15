import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useMyListings(enabled = true) {
  return useQuery({
    queryKey: ['my-listings'],
    queryFn: () => apiFetch('/api/listings/mine/'),
    enabled,
  })
}
