import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useMyCreditScore() {
  return useQuery({
    queryKey: ['my-credit-score'],
    queryFn: () => apiFetch('/api/credit/scores/me/'),
  })
}
