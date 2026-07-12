import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useStaffRoster() {
  return useQuery({
    queryKey: ['staff-roster'],
    queryFn: () => apiFetch('/api/accounts/staff/'),
  })
}
