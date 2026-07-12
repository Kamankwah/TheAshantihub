import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useMySubscription() {
  return useQuery({
    queryKey: ['my-subscription'],
    queryFn: () => apiFetch('/api/billing/subscriptions/me/'),
  })
}
