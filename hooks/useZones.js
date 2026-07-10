import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: () => apiFetch('/api/listings/zones/'),
  })
}
