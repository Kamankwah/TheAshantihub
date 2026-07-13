import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => apiFetch('/api/billing/plans/'),
  })
}
