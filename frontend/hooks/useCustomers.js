import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useCustomers() {
  return useQuery({
    queryKey: ['staff-customers'],
    queryFn: () => apiFetch('/api/accounts/customers/'),
  })
}
