import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useBusinessProfile(enabled = true) {
  return useQuery({
    queryKey: ['business-profile'],
    queryFn: () => apiFetch('/api/accounts/business-owners/me/profile/'),
    enabled,
  })
}
