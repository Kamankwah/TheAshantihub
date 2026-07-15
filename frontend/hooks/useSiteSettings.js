import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useSiteSettings() {
  return useQuery({
    queryKey: ['site-settings'],
    queryFn: () => apiFetch('/api/core/site-settings/'),
  })
}
