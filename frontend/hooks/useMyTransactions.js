import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useMyTransactions() {
  return useQuery({
    queryKey: ['my-transactions'],
    queryFn: () => apiFetch('/api/billing/transactions/mine/'),
  })
}
