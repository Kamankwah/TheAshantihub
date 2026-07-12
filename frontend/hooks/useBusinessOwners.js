import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useBusinessOwners() {
  return useQuery({
    queryKey: ['staff-business-owners'],
    queryFn: () => apiFetch('/api/accounts/business-owners/'),
  })
}
